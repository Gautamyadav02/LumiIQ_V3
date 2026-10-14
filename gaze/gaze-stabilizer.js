(function (root) {
  'use strict';

  const OneEuro2D =
    root.OneEuroFilter2D ||
    (typeof require !== 'undefined' ? require('./one-euro-filter.js').OneEuroFilter2D : null);

  class GazeStabilizer {
    constructor(opts = {}) {
      this.euro = new OneEuro2D({
        minCutoff: opts.minCutoff != null ? opts.minCutoff : 1.2,
        beta: opts.beta != null ? opts.beta : 0.012,
        dCutoff: opts.dCutoff != null ? opts.dCutoff : 1.0,
      });
      this.deadband = opts.deadband != null ? opts.deadband : 3.0; // px
      // Phase C (C6): smooth low-confidence frames more, by lowering the filter's
      // minimum cutoff in proportion to confidence (never below 0.3 of it).
      this.confidenceWeighting = opts.confidenceWeighting === true;
      this.baseMinCutoff = this.euro.fx.minCutoff;
      this.width = opts.width || (typeof window !== 'undefined' ? window.innerWidth : 1920);
      this.height = opts.height || (typeof window !== 'undefined' ? window.innerHeight : 1080);

      this.last = null;
      this.lastRaw = null;
      this.lastT = null;
      this.speed = 0; // px/s, smoothed — exposed for diagnostics
      this._last = { x: 0, y: 0 };
      this._rawBuf = { x: 0, y: 0 };
    }

    setBounds(width, height) {
      this.width = width;
      this.height = height;
    }

    setParams(opts = {}) {
      this.euro.setParams(opts);
      if (opts.minCutoff != null) this.baseMinCutoff = opts.minCutoff;
      if (opts.deadband != null) this.deadband = opts.deadband;
      if (opts.confidenceWeighting != null) this.confidenceWeighting = opts.confidenceWeighting;
    }

    /**
     * @param {number} x  Raw predicted x (px)
     * @param {number} y  Raw predicted y (px)
     * @param {number} t  Timestamp (ms)
     * @param {number} [confidence=1]  0..1; used only with confidenceWeighting (C6)
     * @returns {{x:number,y:number}} Stabilized cursor position (px).
     */
    process(x, y, t, confidence = 1) {
      if (this.confidenceWeighting) {
        // Set from the base value every frame, so the scaling never compounds.
        const c = confidence == null || !Number.isFinite(confidence) ? 1 : Math.min(1, confidence);
        const cutoff = this.baseMinCutoff * Math.max(0.3, c);
        this.euro.fx.minCutoff = cutoff;
        this.euro.fy.minCutoff = cutoff;
      }
      const f = this.euro.filter(x, y, t);

      // Track instantaneous speed (for diagnostics / adaptive dwell).
      if (this.lastRaw && t != null && this.lastT != null && t > this.lastT) {
        const dt = (t - this.lastT) / 1000;
        const inst = Math.hypot(f.x - this.lastRaw.x, f.y - this.lastRaw.y) / dt;
        this.speed = this.speed * 0.7 + inst * 0.3;
      }
      this._rawBuf.x = f.x;
      this._rawBuf.y = f.y;
      this.lastRaw = this._rawBuf;
      this.lastT = t;

      // Deadband: hold position if the move is below the jitter threshold.
      const held = this.last && Math.hypot(f.x - this.last.x, f.y - this.last.y) < this.deadband;
      const nx = Math.max(0, Math.min(this.width, held ? this.last.x : f.x));
      const ny = Math.max(0, Math.min(this.height, held ? this.last.y : f.y));

      // `last` is internal state kept in its own object; the caller gets a fresh
      // point so a reference held across frames never mutates underneath them.
      this._last.x = nx;
      this._last.y = ny;
      this.last = this._last;
      return { x: nx, y: ny };
    }

    getStats() {
      return { speed: this.speed, deadband: this.deadband };
    }

    reset() {
      this.euro.reset();
      this.last = null;
      this.lastRaw = null;
      this.lastT = null;
      this.speed = 0;
      this._last.x = 0;
      this._last.y = 0;
      this._rawBuf.x = 0;
      this._rawBuf.y = 0;
    }
  }

  /**
   * The "smoothing" setting (0.05 least … 0.45 most) as One Euro parameters.
   * Lower minCutoff = smoother at rest. Used by the engine every frame and by
   * the offline replay, so both smooth identically.
   */
  GazeStabilizer.paramsFor = function (smoothingFactor) {
    const f = Math.min(0.45, Math.max(0.05, smoothingFactor != null ? smoothingFactor : 0.35));
    return {
      minCutoff: 3.5 - f * 4.0,     // 0.05→3.3Hz (τ≈48ms) … 0.45→1.7Hz (τ≈94ms)
      beta: 0.04 - f * 0.05,         // higher beta for aggressive saccade tracking
      deadband: 2.5,
    };
  };

  root.GazeStabilizer = GazeStabilizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { GazeStabilizer };
})(typeof window !== 'undefined' ? window : globalThis);
