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
      if (opts.deadband != null) this.deadband = opts.deadband;
    }

    /**
     * @param {number} x  Raw predicted x (px)
     * @param {number} y  Raw predicted y (px)
     * @param {number} t  Timestamp (ms)
     * @returns {{x:number,y:number}} Stabilized cursor position (px).
     */
    process(x, y, t) {
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

  root.GazeStabilizer = GazeStabilizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { GazeStabilizer };
})(typeof window !== 'undefined' ? window : globalThis);
