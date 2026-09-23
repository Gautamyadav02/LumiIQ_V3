/**
 * LumiIQ Gaze Engine V3 — Dwell Controller
 *
 * A robust dwell-to-click state machine. Naive dwell ("cursor over a button for
 * N ms → click") misfires constantly because gaze drifts and the cursor grazes
 * neighbouring targets. This controller adds the stages a clinical tool needs:
 *
 *   IDLE ─▶ FOCUSING ─▶ DWELLING ─▶ (activate) ─▶ cooldown ─▶ IDLE
 *
 *   • Focus detection     — a target must be gazed at before dwell even starts.
 *   • Stability validation — the gaze must settle within a small radius
 *                            (focusRadius) for focusTime ms; drifting re-arms it.
 *   • Dwell confirmation   — a progress timer the caller renders as a ring.
 *   • Cancel detection     — leaving the stable zone mid-dwell aborts cleanly.
 *   • Adaptive timing      — steadier gaze confirms slightly faster.
 *   • Cooldown             — prevents accidental double-activation.
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

      this.hitTest = opts.hitTest || (() => null);
      this.onProgress = opts.onProgress || (() => {});
      this.onActivate = opts.onActivate || (() => {});
      this.onFocusChange = opts.onFocusChange || (() => {});

      this._reset();
      this.cooldownUntil = 0;
      this._jitter = 0; // EMA of in-dwell drift, drives adaptive timing
    }

    _reset() {
      this.state = STATE.IDLE;
      this.target = null;
      this.anchor = null;
      this.focusStart = 0;
      this.dwellStart = 0;
    }

    setDwellTime(ms) { this.dwellTime = ms; }

    setParams(opts = {}) {
      if (opts.dwellTime != null) this.dwellTime = opts.dwellTime;
      if (opts.focusTime != null) this.focusTime = opts.focusTime;
      if (opts.focusRadius != null) this.focusRadius = opts.focusRadius;
      if (opts.cancelRadius != null) this.cancelRadius = opts.cancelRadius;
      if (opts.cooldown != null) this.cooldown = opts.cooldown;
      if (opts.adaptive != null) this.adaptive = opts.adaptive;
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

    /**
     * Drive the state machine one step.
     * @param {number} x  Stabilized gaze x (px)
     * @param {number} y  Stabilized gaze y (px)
     * @param {number} t  Timestamp (ms)
     */
    update(x, y, t) {
      if (t < this.cooldownUntil) return; // Refractory period after an activation.

      const target = this.hitTest(x, y);

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
          this.dwellStart = t;
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
          this.onProgress(target, 0);
          return;
        }
        // Track drift to feed adaptive timing.
        this._jitter = this._jitter * 0.8 + drift * 0.2;

        const dwell = this._effectiveDwell();
        const p = Math.max(0, Math.min(1, (t - this.dwellStart) / dwell));
        this.onProgress(target, p);

        if (p >= 1) {
          const fired = target;
          this.cooldownUntil = t + this.cooldown;
          this.onProgress(fired, 0);
          this._reset();
          this.onActivate(fired);
        }
      }
    }

    getState() { return this.state; }

    getStats() {
      return { state: this.state, jitter: this._jitter, effectiveDwell: this._effectiveDwell() };
    }

    cancel() { this._abort(); }
  }

  DwellController.STATE = STATE;
  root.DwellController = DwellController;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DwellController, STATE };
})(typeof window !== 'undefined' ? window : globalThis);
