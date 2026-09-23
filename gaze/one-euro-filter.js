/**
 * LumiIQ Gaze Engine V3 — One Euro Filter
 *
 * The One Euro Filter (Casiez, Roussel & Vogel, CHI 2012) is the gold-standard
 * low-latency smoothing filter for noisy interactive signals. Unlike a fixed
 * exponential moving average, it adapts its cutoff frequency to the signal's
 * speed: slow movements (a fixation) are smoothed hard to kill jitter, while
 * fast movements (a saccade) are barely smoothed so the cursor stays responsive.
 *
 * This is exactly what gaze tracking needs — a steady cursor when the patient
 * fixates on a key, but no rubber-banding lag when they look across the screen.
 *
 * Reference: https://gery.casiez.net/1euro/
 */
(function (root) {
  'use strict';

  /** First-order low-pass filter (the building block of the One Euro filter). */
  class LowPassFilter {
    constructor() {
      this.hatXPrev = null;
      this.initialized = false;
    }

    /** Smoothing factor for a given cutoff frequency and timestep. */
    static alpha(cutoff, dt) {
      const tau = 1.0 / (2 * Math.PI * cutoff);
      return 1.0 / (1.0 + tau / dt);
    }

    filter(x, alpha) {
      let hatX;
      if (!this.initialized) {
        hatX = x;
        this.initialized = true;
      } else {
        hatX = alpha * x + (1 - alpha) * this.hatXPrev;
      }
      this.hatXPrev = hatX;
      return hatX;
    }

    reset() {
      this.hatXPrev = null;
      this.initialized = false;
    }
  }

  /**
   * One Euro Filter for a single scalar channel.
   *
   * @param {object} [opts]
   * @param {number} [opts.minCutoff=1.0]  Minimum cutoff frequency (Hz). Lower = smoother but laggier at rest.
   * @param {number} [opts.beta=0.007]     Speed coefficient. Higher = more responsive to fast motion.
   * @param {number} [opts.dCutoff=1.0]    Cutoff for the derivative low-pass.
   * @param {number} [opts.freq=60]        Fallback frequency (Hz) used before timestamps are available.
   */
  class OneEuroFilter {
    constructor(opts = {}) {
      this.minCutoff = opts.minCutoff != null ? opts.minCutoff : 1.0;
      this.beta = opts.beta != null ? opts.beta : 0.007;
      this.dCutoff = opts.dCutoff != null ? opts.dCutoff : 1.0;
      this.freq = opts.freq != null ? opts.freq : 60;

      this.xFilter = new LowPassFilter();
      this.dxFilter = new LowPassFilter();
      this.lastTime = null;
      this.xPrev = null;
    }

    /**
     * @param {number} x          Raw value.
     * @param {number} [timestamp] Time in ms (e.g. performance.now()). Optional.
     * @returns {number} Filtered value.
     */
    filter(x, timestamp) {
      // Derive timestep (seconds) from timestamps when available, else fall back to freq.
      let dt;
      if (timestamp != null && this.lastTime != null) {
        dt = (timestamp - this.lastTime) / 1000;
      } else {
        dt = 1.0 / this.freq;
      }
      // Clamp minimum dt to prevent derivative spikes from near-zero timesteps
      dt = Math.max(dt, 0.001);
      if (!isFinite(dt)) dt = 1.0 / this.freq;
      this.lastTime = timestamp != null ? timestamp : this.lastTime;

      // Estimate the rate of change and low-pass it.
      const dx = this.xPrev == null ? 0 : (x - this.xPrev) / dt;
      this.xPrev = x;
      const edx = this.dxFilter.filter(dx, LowPassFilter.alpha(this.dCutoff, dt));

      // Adapt the cutoff to the (smoothed) speed, then low-pass the value.
      const cutoff = this.minCutoff + this.beta * Math.abs(edx);
      return this.xFilter.filter(x, LowPassFilter.alpha(cutoff, dt));
    }

    setParams(opts = {}) {
      if (opts.minCutoff != null) this.minCutoff = opts.minCutoff;
      if (opts.beta != null) this.beta = opts.beta;
      if (opts.dCutoff != null) this.dCutoff = opts.dCutoff;
    }

    reset() {
      this.xFilter.reset();
      this.dxFilter.reset();
      this.lastTime = null;
      this.xPrev = null;
    }
  }

  /** Convenience wrapper that filters a 2D point (x, y) with two One Euro filters. */
  class OneEuroFilter2D {
    constructor(opts = {}) {
      this.fx = new OneEuroFilter(opts);
      this.fy = new OneEuroFilter(opts);
      this._out = { x: 0, y: 0 }; // Reusable output buffer
    }

    filter(x, y, timestamp) {
      this._out.x = this.fx.filter(x, timestamp);
      this._out.y = this.fy.filter(y, timestamp);
      return this._out;
    }

    setParams(opts) {
      this.fx.setParams(opts);
      this.fy.setParams(opts);
    }

    reset() {
      this.fx.reset();
      this.fy.reset();
    }
  }

  const api = { LowPassFilter, OneEuroFilter, OneEuroFilter2D };
  root.OneEuroFilter = OneEuroFilter;
  root.OneEuroFilter2D = OneEuroFilter2D;
  root.LowPassFilter = LowPassFilter;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
