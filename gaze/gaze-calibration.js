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
   *
   * `strict` (Phase C, C3): drop a sample that is an outlier in 25% or more of the
   * dimensions. With 10 features that means 3, which is what a frame disturbed by
   * the eyelids looks like (ly, ry and ear); the Phase B rule let it through.
   */
  function rejectOutliers(samples, maxKeep, strict = false) {
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
      return strict ? bad / D < 0.25 : bad / D <= 0.3;
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

  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  class GazeCalibration {
    /**
     * @param {object} [opts]
     * @param {number|'auto'} [opts.degree=2]  polynomial degree; 'auto' (Phase C, C5) fits
     *   degree 1 and 2 and keeps the one with the lower leave-one-target-out error
     * @param {number}  [opts.settleMs=0]       ignore samples this long after a target change (C4)
     * @param {boolean} [opts.strictOutliers]   the stricter outlier rule (C3)
     * @param {number}  [opts.stdFloorRatio=0]  floor on feature spread, see StandardScaler (C1)
     * @param {string}  [opts.featureSet]       'image' (Phase B features) or 'head' (C1); stored
     *   with the calibration, because a model only works with the features it was trained on
     * @param {'loto'|'interleaved'} [opts.cv]
     */
    constructor(opts = {}) {
      this.maxSamplesPerPoint = opts.maxSamplesPerPoint || 24;
      this.degreeOption = opts.degree != null ? opts.degree : 2;
      this.degree = typeof this.degreeOption === 'number' ? this.degreeOption : 2;
      // Saccade-settling window (ms), counted from the moment the target changed.
      // Off by default: the app's capture UI already waits for the eye to land and
      // then calls discardCurrentSamples(), so in the app this is a second guard.
      this.settleMs = opts.settleMs != null ? opts.settleMs : 0;
      this.strictOutliers = opts.strictOutliers === true;
      this.stdFloorRatio = opts.stdFloorRatio || 0;
      this.featureSet = opts.featureSet || 'image';
      // How the quality report and lambda are cross-validated: 'loto' (leave one
      // target out, the default since AUDIT M1) or 'interleaved' (the old, optimistic
      // method, kept so the two can be compared on the same samples).
      this.cv = opts.cv === 'interleaved' ? 'interleaved' : 'loto';
      this.reset();
    }

    reset() {
      this.layout = [];
      this.index = -1;
      this.pointBuffer = [];   // raw samples for the in-progress target
      this.trainX = [];        // retained feature rows across all targets
      this.trainYx = [];
      this.trainYy = [];
      this.trainTargetIndices = [];
      this.modelX = null;
      this.modelY = null;
      this.report = null;
      this.isReady = false;
      this.featureDim = 0;
      this._pointStartTime = null;
    }

    /** Begin a calibration run with the given number of points (5/9/16/25); `t` = when the first target appears. */
    begin(pointCount, t) {
      this.reset();
      this.layout = buildLayout(pointCount);
      this.index = 0;
      this.pointBuffer = [];
      this._pointStartTime = t != null ? t : clock();
      return this.currentTarget();
    }

    currentTarget() {
      if (this.index < 0 || this.index >= this.layout.length) return null;
      const t = this.layout[this.index];
      return { x: t.x, y: t.y, index: this.index, total: this.layout.length };
    }

    /** Feed one feature vector for the current target (called per frame); `t` = its time (ms).
     *  Returns whether the sample was kept. */
    addSample(features, t) {
      if (this.index < 0 || this.index >= this.layout.length) return false;
      if (this.settleMs > 0) {
        const now = t != null ? t : clock();
        if (this._pointStartTime === null) this._pointStartTime = now;
        if (now - this._pointStartTime < this.settleMs) return false; // eye still in transit
      }
      this.pointBuffer.push(features.slice());
      return true;
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
    commitPoint(t) {
      const target = this.layout[this.index];
      const cleaned = rejectOutliers(this.pointBuffer, this.maxSamplesPerPoint, this.strictOutliers);
      const rejected = this.pointBuffer.length - cleaned.length;
      for (const f of cleaned) {
        this.trainX.push(f);
        this.trainYx.push(target.x);
        this.trainYy.push(target.y);
        this.trainTargetIndices.push(this.index);
      }
      this.pointBuffer = [];
      this._pointStartTime = t != null ? t : clock();   // the next target appears now
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
      // Lambda is chosen, and the error estimated, by leaving one whole target
      // out at a time (AUDIT M1), so frames of a target are never in both the
      // training and the test fold. selectLambda falls back to interleaved folds
      // if there are fewer than three targets; cvMethod records what was used.
      const targets = this.cv === 'loto' ? this.trainTargetIndices : null;
      const ridge = this.stdFloorRatio ? { stdFloorRatio: this.stdFloorRatio } : null;
      const w = screen && screen.width ? screen.width : 1920;
      const h = screen && screen.height ? screen.height : 1080;
      // C5: with degree 'auto', both degrees are tried and the lower estimated error wins.
      const degrees = this.degreeOption === 'auto' ? [1, 2] : [this.degree];
      const fits = degrees.map((degree) => {
        const grid = RMath.lambdaGrid ? RMath.lambdaGrid(degree) : undefined;
        const sx = RMath.selectLambda(this.trainX, this.trainYx, degree, grid, targets, ridge);
        const sy = RMath.selectLambda(this.trainX, this.trainYy, degree, grid, targets, ridge);
        return { degree, selX: sx, selY: sy, errorPx: Math.hypot(sx.rmse * w, sy.rmse * h) };
      });
      const best = fits.reduce((a, b) => (b.errorPx < a.errorPx ? b : a));
      const { selX, selY } = best;
      this.degree = best.degree;

      // The final models are fitted on all the clean samples.
      this.modelX = new Ridge({ ...ridge, degree: this.degree, lambda: selX.lambda }).fit(this.trainX, this.trainYx);
      this.modelY = new Ridge({ ...ridge, degree: this.degree, lambda: selY.lambda }).fit(this.trainX, this.trainYy);

      const r2 = (selX.r2 + selY.r2) / 2;
      const rmseXPx = selX.rmse * w;
      const rmseYPx = selY.rmse * h;
      const accuracyPx = Math.hypot(rmseXPx, rmseYPx);

      this.featureDim = this.trainX[0].length;
      this.report = {
        ok: true,
        samples: this.trainX.length,
        points: this.layout.length,
        r2: Math.max(0, r2),
        r2x: Math.max(0, selX.r2),
        r2y: Math.max(0, selY.r2),
        confidence: Math.round(Math.max(0, Math.min(1, r2)) * 100),
        accuracyPx: Math.round(accuracyPx),
        rmseXPx: Math.round(rmseXPx * 10) / 10,   // the same estimate, per axis
        rmseYPx: Math.round(rmseYPx * 10) / 10,
        rating: ratingFor(r2),
        lambdaX: selX.lambda,
        lambdaY: selY.lambda,
        cvMethod: selX.method,          // 'loto' or 'interleaved': how the estimate was made
        degree: this.degree,
        // C5: the estimated error (px) of each degree tried
        degreeChoice: Object.fromEntries(fits.map((f) => [f.degree, Math.round(f.errorPx * 10) / 10])),
        featureSet: this.featureSet,
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
        // Version 4 = features measured in the head frame (Phase C, C1); version 3 = the
        // Phase B features. A model only works with the features it was trained on.
        version: this.featureSet === 'head' ? 4 : 3,
        featureSet: this.featureSet,
        featureDim: this.trainX.length > 0 ? this.trainX[0].length : this.featureDim,
        degree: this.degree,
        modelX: this.modelX.toJSON(),
        modelY: this.modelY.toJSON(),
        report: this.report,
      };
    }

    static fromJSON(o) {
      if (!o || (o.version !== 3 && o.version !== 4)) return null;
      const c = new GazeCalibration({ degree: o.degree, featureSet: o.featureSet || (o.version === 4 ? 'head' : 'image') });
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
