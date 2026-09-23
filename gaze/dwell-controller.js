/**
 * LumiIQ Gaze Engine V3 — Dwell Controller
 *
 * A dwell-to-click state machine. Naive dwell ("cursor over a button for
 * N ms → click") misfires constantly because gaze drifts and the cursor grazes
 * neighbouring targets. This controller adds these stages:
 *
 *   IDLE ─▶ FOCUSING ─▶ DWELLING ─▶ (activate) ─▶ cooldown ─▶ IDLE
 *
 *   • Focus detection     — a target must be gazed at before dwell even starts.
 *   • Stability validation — the gaze must settle within a small radius
 *                            (focusRadius) for focusTime ms; drifting re-arms it.
 *   • Dwell confirmation   — a progress value (0..1) the caller renders as a ring.
 *   • Cancel detection     — leaving the stable zone mid-dwell aborts cleanly.
 *   • Gap handling         — if gaze samples stop for longer than maxGapMs (eyes
 *                            closed, face lost), the dwell is cancelled rather
 *                            than completing on the first frame back.
 *   • Monotonic progress   — progress only grows while gaze samples arrive; a
 *                            change of dwell time mid-dwell changes the speed,
 *                            never the level shown to the user.
 *   • Adaptive timing      — steadier gaze confirms slightly faster.
 *   • Cooldown + re-arm    — after an activation, nothing fires for `cooldown`
 *                            ms, and the same target (or the same screen area,
 *                            if the UI redrew it) cannot fire again until the
 *                            gaze has left it.
 *
 * The controller is UI-agnostic: it receives a `hitTest(x,y)` function and emits
 * callbacks; the app renders the progress ring and performs the click.
 */
(function (root) {
  'use strict';

  const STATE = { IDLE: 'idle', FOCUSING: 'focusing', DWELLING: 'dwelling' };

  class DwellController {
    constructor(opts = {}) {
      this.dwellTime = opts.dwellTime != null ? opts.dwellTime : 1000; // ms
      this.focusTime = opts.focusTime != null ? opts.focusTime : 150; // ms to settle
      this.focusRadius = opts.focusRadius != null ? opts.focusRadius : 45; // px settle zone
      this.cancelRadius = opts.cancelRadius != null ? opts.cancelRadius : 90; // px abort zone
      this.cooldown = opts.cooldown != null ? opts.cooldown : 600; // ms after a click
      this.adaptive = opts.adaptive !== false;
      // A gap between gaze samples longer than this cancels the dwell. A normal
      // blink (~100-300 ms) is tolerated; a longer closure or face loss is not.
      this.maxGapMs = opts.maxGapMs != null ? opts.maxGapMs : 300;
      // The most dwell time one sample may add, so a delayed frame (e.g. after a
      // blink) cannot jump the progress.
      this.maxStepMs = opts.maxStepMs != null ? opts.maxStepMs : 100;

      this.hitTest = opts.hitTest || (() => null);
      // Optional target → {left, top, right, bottom}. With it, "re-arm on leave"
      // also covers a target the UI replaced with a new element in the same place.
      this.getRect = opts.getRect || null;
      this.onProgress = opts.onProgress || (() => {});
      this.onActivate = opts.onActivate || (() => {});
      this.onFocusChange = opts.onFocusChange || (() => {});

      this._reset();
      this.cooldownUntil = 0;
      this.lastT = null;        // time of the last gaze sample
      this.blocked = null;      // { target, rect } that just fired; ignored until the gaze leaves it
      this._jitter = 0;         // EMA of in-dwell drift, drives adaptive timing
    }

    _reset() {
      this.state = STATE.IDLE;
      this.target = null;
      this.anchor = null;
      this.focusStart = 0;
      this.progress = 0;
    }

    setDwellTime(ms) { this.dwellTime = ms; }

    setParams(opts = {}) {
      if (opts.dwellTime != null) this.dwellTime = opts.dwellTime;
      if (opts.focusTime != null) this.focusTime = opts.focusTime;
      if (opts.focusRadius != null) this.focusRadius = opts.focusRadius;
      if (opts.cancelRadius != null) this.cancelRadius = opts.cancelRadius;
      if (opts.cooldown != null) this.cooldown = opts.cooldown;
      if (opts.adaptive != null) this.adaptive = opts.adaptive;
      if (opts.maxGapMs != null) this.maxGapMs = opts.maxGapMs;
    }

    /** Effective dwell time, shortened when the gaze is very steady. */
    _effectiveDwell() {
      if (!this.adaptive) return this.dwellTime;
      // jitter normalized against focusRadius: 0 (rock steady) → 0.85x, high → 1.15x
      const norm = Math.min(1, this._jitter / this.focusRadius);
      const factor = 0.85 + 0.3 * norm;
      return this.dwellTime * factor;
    }

    /** Abort any in-progress dwell on the current target and notify the UI. */
    _abort() {
      if (this.target) this.onProgress(this.target, 0);
      const prev = this.target;
      this._reset();
      return prev;
    }

    /** True while the gaze is still on the target that just fired; clears the block once it leaves. */
    _stillOnFiredTarget(hit, x, y) {
      const b = this.blocked;
      if (!b) return false;
      const insideRect = b.rect != null &&
        x >= b.rect.left && x <= b.rect.right && y >= b.rect.top && y <= b.rect.bottom;
      if (hit === b.target || insideRect) return true;
      this.blocked = null; // the gaze has left it: re-armed
      return false;
    }

    /**
     * Report a frame with no usable gaze (eyes closed, no face, low confidence).
     * Once the gap exceeds maxGapMs, any dwell in progress is cancelled.
     * @param {number} t  Timestamp (ms), same clock as update()
     */
    noGaze(t) {
      if (this.state !== STATE.IDLE && this.lastT != null && t - this.lastT > this.maxGapMs) this._abort();
    }

    /**
     * Drive the state machine one step.
     * @param {number} x  Stabilized gaze x (px)
     * @param {number} y  Stabilized gaze y (px)
     * @param {number} t  Timestamp (ms)
     */
    update(x, y, t) {
      const dt = this.lastT == null ? 0 : t - this.lastT;
      this.lastT = t;
      if (t < this.cooldownUntil) return; // Refractory period after an activation.

      // Samples stopped for too long: start over instead of completing on this frame.
      if (dt > this.maxGapMs && this.state !== STATE.IDLE) this._abort();

      let target = this.hitTest(x, y);
      if (this._stillOnFiredTarget(target, x, y)) target = null;

      // No dwellable target under the gaze → cancel anything in flight.
      if (!target) {
        if (this.state !== STATE.IDLE) this._abort();
        return;
      }

      // Switched to a different target → restart focus on it.
      if (target !== this.target) {
        if (this.target) this.onProgress(this.target, 0);
        this.target = target;
        // Anchor where the gaze actually is, not the element centre: on a target
        // wider than cancelRadius (the space bar, Nurse Call) a centre anchor
        // reads a legitimate edge fixation as a cancel-sized drift, so the dwell
        // bounces and can never complete. Keeps the controller UI-agnostic too.
        this.anchor = { x, y };
        this.focusStart = t;
        this.state = STATE.FOCUSING;
        this.progress = 0;
        this._jitter = 0;
        this.onFocusChange(target);
        this.onProgress(target, 0);
        return;
      }

      const drift = Math.hypot(x - this.anchor.x, y - this.anchor.y);

      if (this.state === STATE.FOCUSING) {
        // Must hold steady within focusRadius for focusTime before dwelling.
        if (drift > this.focusRadius) {
          this.anchor = { x, y };
          this.focusStart = t;
        } else if (t - this.focusStart >= this.focusTime) {
          this.state = STATE.DWELLING;
          this.progress = 0;
          // Re-anchor to the point the gaze actually settled on.
          this.anchor = { x, y };
          this._jitter = 0;
        }
        this.onProgress(target, 0);
        return;
      }

      if (this.state === STATE.DWELLING) {
        // Cancel detection: a large excursion drops back to focusing.
        if (drift > this.cancelRadius) {
          this.state = STATE.FOCUSING;
          this.focusStart = t;
          this.anchor = { x, y };
          this.progress = 0;
          this.onProgress(target, 0);
          return;
        }
        // Track drift to feed adaptive timing.
        this._jitter = this._jitter * 0.8 + drift * 0.2;

        // Add this frame's share of the dwell time (capped). Changing the dwell
        // time mid-dwell therefore changes the speed, never jumps the level.
        this.progress = Math.min(1, this.progress + Math.min(dt, this.maxStepMs) / this._effectiveDwell());
        this.onProgress(target, this.progress);

        if (this.progress >= 1) {
          const fired = target;
          this.cooldownUntil = t + this.cooldown;
          this.blocked = { target: fired, rect: this.getRect ? this.getRect(fired) : null };
          this.onProgress(fired, 0);
          this._reset();
          this.onActivate(fired);
        }
      }
    }

    getState() { return this.state; }

    getStats() {
      return { state: this.state, progress: this.progress, jitter: this._jitter, effectiveDwell: this._effectiveDwell() };
    }

    cancel() {
      this._abort();
      this.lastT = null;
    }
  }

  DwellController.STATE = STATE;
  root.DwellController = DwellController;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DwellController, STATE };
})(typeof window !== 'undefined' ? window : globalThis);
