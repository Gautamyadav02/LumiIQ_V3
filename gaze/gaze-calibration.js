/**
 * LumiIQ Gaze Engine V3 — Calibration System
 *
 * Owns the calibration lifecycle: target layout, robust sample collection,
 * model training, and a quality report. The patient looks at a sequence of
 * on-screen targets; for each target we collect many feature vectors, throw out
 * the ones corrupted by blinks / dropped frames, and keep the clean ones as
 * training rows. Two ridge regressors (one for screen-X, one for screen-Y) are
 * then fit over all retained samples.
 *
 * Targets are expressed in NORMALIZED screen coordinates (0..1), so the same
 * calibration is resolution-independent.
 *
 * Depends on RidgeRegressor (ridge-regression.js).
 */
(function (root) {
  'use strict';

  const Ridge =
    root.RidgeRegressor ||
    (typeof require !== 'undefined' ? require('./ridge-regression.js').RidgeRegressor : null);
  const RMath =
    root.GazeRegressionMath ||
    (typeof require !== 'undefined' ? require('./ridge-regression.js') : null);

  const MARGIN = 0.08; // keep targets off the extreme screen edge

  /** Evenly spaced grid coordinates between MARGIN and 1-MARGIN. */
  function axis(n) {
    if (n === 1) return [0.5];
    const out = [];
    for (let i = 0; i < n; i++) out.push(MARGIN + (i / (n - 1)) * (1 - 2 * MARGIN));
    return out;
  }

  /** Build a target list for a given point count, ordered to minimize gaze travel. */
  function buildLayout(pointCount) {
    if (pointCount === 5) {
      const lo = MARGIN, hi = 1 - MARGIN, mid = 0.5;
      return [
        { x: mid, y: mid }, { x: lo, y: lo }, { x: hi, y: lo },
        { x: hi, y: hi }, { x: lo, y: hi },
      ];
    }
    const grid = { 9: 3, 16: 4, 25: 5 }[pointCount];
    if (!grid) throw new Error('Unsupported calibration point count: ' + pointCount);
    const coords = axis(grid);
    const pts = [];
    // Boustrophedon (snake) row order so consecutive targets are adjacent.
    for (let r = 0; r < grid; r++) {
      const rowCols = r % 2 === 0 ? coords : coords.slice().reverse();
      for (const cx of rowCols) pts.push({ x: cx, y: coords[r] });
    }
    return pts;
  }

  function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Robustly reject corrupted samples for one target. For each feature dimension
   * we compute the median and MAD (median absolute deviation); a sample that is a
   * gross outlier (> 4 MAD) in more than 30% of dimensions is dropped — this is
   * what blinks and momentary tracking loss look like.
   */
  function rejectOutliers(samples, maxKeep) {
    if (samples.length <= 4) return samples.slice();
    const D = samples[0].length;
    const med = new Array(D);
    const mad = new Array(D);
    for (let d = 0; d < D; d++) {
      const col = samples.map((s) => s[d]);
      med[d] = median(col);
      mad[d] = median(col.map((v) => Math.abs(v - med[d]))) || 1e-6;
    }
    const good = samples.filter((s) => {
      let bad = 0;
      for (let d = 0; d < D; d++) if (Math.abs(s[d] - med[d]) > 4 * mad[d]) bad++;
      return bad / D <= 0.3;
    });
    const kept = good.length >= 3 ? good : samples.slice();

    // Subsample evenly to bound the training-set size.
    if (kept.length <= maxKeep) return kept;
    const out = [];
    const step = kept.length / maxKeep;
    for (let i = 0; i < maxKeep; i++) out.push(kept[Math.floor(i * step)]);
    return out;
  }

  function ratingFor(r2) {
    if (r2 >= 0.9) return 'Excellent';
    if (r2 >= 0.8) return 'Good';
    if (r2 >= 0.65) return 'Fair';
    return 'Poor';
  }

  class GazeCalibration {
    constructor(opts = {}) {
      this.maxSamplesPerPoint = opts.maxSamplesPerPoint || 24;
      this.degree = opts.degree != null ? opts.degree : 2;
      // Saccade-settling window (ms), off by default: the caller driving the
      // capture UI knows when the eye has landed and calls discardCurrentSamples()
      // at that moment, so a second settle authority here would only eat the
      // front of the collection window twice.
      this.settleMs = opts.settleMs != null ? opts.settleMs : 0;
      this.reset();
    }

    reset() {
      this.layout = [];
      this.index = -1;
      this.pointBuffer = [];   // raw samples for the in-progress target
      this.trainX = [];        // retained feature rows across all targets
      this.trainYx = [];
      this.trainYy = [];
      this.modelX = null;
      this.modelY = null;
      this.report = null;
      this.isReady = false;
      this.featureDim = 0;
      this._pointStartTime = null;
    }

    /** Begin a calibration run with the given number of points (5/9/16/25). */
    begin(pointCount) {
      this.reset();
      this.layout = buildLayout(pointCount);
      this.index = 0;
      this.pointBuffer = [];
      return this.currentTarget();
    }

    currentTarget() {
      if (this.index < 0 || this.index >= this.layout.length) return null;
      const t = this.layout[this.index];
      return { x: t.x, y: t.y, index: this.index, total: this.layout.length };
    }

    /** Feed one feature vector for the current target (called per frame). */
    addSample(features) {
      if (this.index < 0 || this.index >= this.layout.length) return;
      if (this.settleMs > 0) {
        const now = performance.now();
        if (this._pointStartTime === null) this._pointStartTime = now;
        if (now - this._pointStartTime < this.settleMs) return; // eye still in transit
      }
      this.pointBuffer.push(features.slice());
    }

    sampleCount() { return this.pointBuffer.length; }

    /** Drop samples gathered for the current target (e.g. the eye-in-transit
     *  settle phase) before the real collection window begins.
     *  `_pointStartTime` is deliberately kept: the caller clearing here has
     *  already waited out its own settle window, so restarting the settle timer
     *  would silently eat the front of the collection window a second time. */
    discardCurrentSamples() { this.pointBuffer = []; }

    /**
     * Finish the current target: clean its samples, fold them into the training
     * set, and advance. Returns progress info.
     */
    commitPoint() {
      const target = this.layout[this.index];
      const cleaned = rejectOutliers(this.pointBuffer, this.maxSamplesPerPoint);
      const rejected = this.pointBuffer.length - cleaned.length;
      for (const f of cleaned) {
        this.trainX.push(f);
        this.trainYx.push(target.x);
        this.trainYy.push(target.y);
      }
      this.pointBuffer = [];
      this._pointStartTime = null;
      this.index++;
      const done = this.index >= this.layout.length;
      return {
        done,
        accepted: cleaned.length,
        rejected,
        next: done ? null : this.currentTarget(),
      };
    }

    /**
     * Train both regressors over all retained samples and produce a quality
     * report. Lambda is auto-selected by cross-validation.
     * @param {{width:number,height:number}} [screen] for px-accuracy estimate.
     */
    train(screen) {
      if (this.trainX.length < 10) {
        return { ok: false, reason: 'insufficient_samples', samples: this.trainX.length };
      }
      const selX = RMath.selectLambda(this.trainX, this.trainYx, this.degree);
      const selY = RMath.selectLambda(this.trainX, this.trainYy, this.degree);

      this.modelX = new Ridge({ degree: this.degree, lambda: selX.lambda }).fit(this.trainX, this.trainYx);
      this.modelY = new Ridge({ degree: this.degree, lambda: selY.lambda }).fit(this.trainX, this.trainYy);

      // Cross-validated metrics = honest (non-overfit) accuracy estimate.
      const cvX = RMath.crossValR2(this.trainX, this.trainYx, { degree: this.degree, lambda: selX.lambda });
      const cvY = RMath.crossValR2(this.trainX, this.trainYy, { degree: this.degree, lambda: selY.lambda });
      const r2 = (cvX.r2 + cvY.r2) / 2;

      const w = screen && screen.width ? screen.width : 1920;
      const h = screen && screen.height ? screen.height : 1080;
      const accuracyPx = Math.hypot(cvX.rmse * w, cvY.rmse * h);

      this.featureDim = this.trainX[0].length;
      this.report = {
        ok: true,
        samples: this.trainX.length,
        points: this.layout.length,
        r2: Math.max(0, r2),
        r2x: Math.max(0, cvX.r2),
        r2y: Math.max(0, cvY.r2),
        confidence: Math.round(Math.max(0, Math.min(1, r2)) * 100),
        accuracyPx: Math.round(accuracyPx),
        rating: ratingFor(r2),
        lambdaX: selX.lambda,
        lambdaY: selY.lambda,
      };
      this.isReady = true;
      return this.report;
    }

    /** Predict normalized screen coordinates (0..1) from a feature vector. */
    predict(features) {
      if (!this.isReady) return null;
      return {
        x: Math.max(0, Math.min(1, this.modelX.predictRow(features))),
        y: Math.max(0, Math.min(1, this.modelY.predictRow(features))),
      };
    }

    /** Serialize a trained calibration for persistence (LumiStore / localStorage). */
    toJSON() {
      if (!this.isReady) return null;
      return {
        version: 3,
        featureDim: this.trainX.length > 0 ? this.trainX[0].length : 0,
        degree: this.degree,
        modelX: this.modelX.toJSON(),
        modelY: this.modelY.toJSON(),
        report: this.report,
      };
    }

    static fromJSON(o) {
      if (!o || o.version !== 3) return null;
      const c = new GazeCalibration({ degree: o.degree });
      // The expected feature width belongs to whoever builds the vectors, so it
      // is surfaced here for the caller to check rather than hardcoded.
      c.featureDim = o.featureDim || 0;
      c.modelX = Ridge.fromJSON(o.modelX);
      c.modelY = Ridge.fromJSON(o.modelY);
      c.report = o.report;
      c.isReady = true;
      return c;
    }
  }

  GazeCalibration.buildLayout = buildLayout;
  GazeCalibration.rejectOutliers = rejectOutliers;
  root.GazeCalibration = GazeCalibration;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GazeCalibration, buildLayout, rejectOutliers };
  }
})(typeof window !== 'undefined' ? window : globalThis);
