/**
 * LumiIQ Gaze Engine V3 — Ridge Regression
 *
 * Browser-native, dependency-free regression for mapping eye features to screen
 * coordinates. The Python prototype called for GradientBoosting / RandomForest /
 * XGBoost, but none of those run in a browser — and for the smooth, continuous
 * iris-to-pixel mapping we need, a *ridge regression over polynomial features* is
 * both faster (closed-form, microseconds to predict) and well-suited: it produces
 * a smooth surface with no decision-tree "staircase" artifacts, and L2
 * regularization keeps it stable even with the limited samples a webcam
 * calibration collects. This is the same family of model used by production
 * webcam eye-trackers such as WebGazer.
 *
 * Pipeline:  raw features → polynomial expansion → z-score standardization →
 *            ridge least-squares (solved by Householder QR on an augmented
 *            system, which is numerically safer than the normal equations).
 */
(function (root) {
  'use strict';

  // ── Small dense linear-algebra helpers ──────────────────────────────────

  /** Solve A x = b for a square matrix A using Gauss-Jordan with partial pivoting. */
  function solveLinearSystemGJ(A, b) {
    const n = A.length;
    // Build augmented matrix [A | b] with copies (do not mutate inputs).
    const M = A.map((row, i) => row.slice().concat([b[i]]));

    for (let col = 0; col < n; col++) {
      // Partial pivot: find the row with the largest magnitude in this column.
      let pivot = col;
      let maxVal = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(M[r][col]);
        if (v > maxVal) { maxVal = v; pivot = r; }
      }
      if (maxVal < 1e-12) {
          // Column is near-singular — zero out this weight and continue
          console.warn(`Ridge regression: near-singular column ${col}, zeroing weight`);
          for (let r = 0; r < n; r++) M[r][col] = 0;
          continue;
      }
      if (pivot !== col) { const tmp = M[pivot]; M[pivot] = M[col]; M[col] = tmp; }

      // Normalize pivot row.
      const pv = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= pv;

      // Eliminate this column from every other row.
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (factor === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map((row) => row[n]);
  }

  /**
   * Solve an overdetermined system Ax = b via Householder QR decomposition.
   * More numerically stable than normal equations since it avoids forming AᵀA.
   * @param {number[][]} A  (m × n) matrix, m >= n
   * @param {number[]}   b  (m) right-hand side
   * @returns {number[]}    (n) solution vector
   */
  function solveQR(A, b) {
    const m = A.length;
    const n = A[0].length;
    // Deep copy into Float64Arrays for numerical precision
    const R = new Array(m);
    for (let i = 0; i < m; i++) {
      R[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) R[i][j] = A[i][j];
    }
    const rhs = new Float64Array(m);
    for (let i = 0; i < m; i++) rhs[i] = b[i];

    // Householder QR factorization
    const minMN = Math.min(m, n);
    for (let k = 0; k < minMN; k++) {
      // Compute norm of column k below the diagonal
      let sigma = 0;
      for (let i = k; i < m; i++) sigma += R[i][k] * R[i][k];
      sigma = Math.sqrt(sigma);
      if (sigma < 1e-15) continue;

      // Choose sign to avoid cancellation
      if (R[k][k] < 0) sigma = -sigma;

      // Build Householder vector v in-place (stored in R below diagonal)
      R[k][k] += sigma;
      const invScale = 1.0 / (sigma * R[k][k]); // = 1 / (sigma * v[0])

      // Apply H = I - (1/(sigma*v[0])) * v * vᵀ to remaining columns
      for (let j = k + 1; j < n; j++) {
        let dot = 0;
        for (let i = k; i < m; i++) dot += R[i][k] * R[i][j];
        dot *= invScale;
        for (let i = k; i < m; i++) R[i][j] -= R[i][k] * dot;
      }

      // Apply same reflection to rhs
      let dotB = 0;
      for (let i = k; i < m; i++) dotB += R[i][k] * rhs[i];
      dotB *= invScale;
      for (let i = k; i < m; i++) rhs[i] -= R[i][k] * dotB;

      // Store the diagonal element of R
      R[k][k] = -sigma;
    }

    // Back-substitution: R x = Q^T b
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = rhs[i];
      for (let j = i + 1; j < n; j++) sum -= R[i][j] * x[j];
      x[i] = Math.abs(R[i][i]) > 1e-15 ? sum / R[i][i] : 0;
    }
    return Array.from(x);
  }

  // ── Polynomial feature expansion ────────────────────────────────────────

  /**
   * Expands an input vector into polynomial terms (without a bias term — the
   * regressor adds its own intercept). Degree 2 includes every squared term and
   * every pairwise interaction, which lets the model capture the mild
   * non-linearity between iris position and screen angle.
   */
  class PolynomialFeatures {
    constructor(degree = 2) {
      this.degree = degree;
    }

    transform(x) {
      const out = x.slice(); // degree-1 terms
      if (this.degree >= 2) {
        for (let i = 0; i < x.length; i++) {
          for (let j = i; j < x.length; j++) {
            out.push(x[i] * x[j]);
          }
        }
      }
      return out;
    }

    transformAll(X) {
      return X.map((row) => this.transform(row));
    }
  }

  // ── Standardization (z-score) ───────────────────────────────────────────

  class StandardScaler {
    fit(X) {
      const n = X.length;
      const p = X[0].length;
      this.mean = new Array(p).fill(0);
      this.std = new Array(p).fill(0);
      for (let j = 0; j < p; j++) {
        let m = 0;
        for (let i = 0; i < n; i++) m += X[i][j];
        m /= n;
        let v = 0;
        for (let i = 0; i < n; i++) { const d = X[i][j] - m; v += d * d; }
        v = Math.sqrt(v / n);
        this.mean[j] = m;
        this.std[j] = v > 1e-9 ? v : 1.0; // Avoid divide-by-zero on constant columns.
      }
      return this;
    }

    transformRow(x) {
      const out = new Array(x.length);
      for (let j = 0; j < x.length; j++) out[j] = (x[j] - this.mean[j]) / this.std[j];
      return out;
    }

    transform(X) {
      return X.map((row) => this.transformRow(row));
    }
  }

  // ── Metrics ─────────────────────────────────────────────────────────────

  function r2Score(yTrue, yPred) {
    const n = yTrue.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += yTrue[i];
    mean /= n;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      ssRes += (yTrue[i] - yPred[i]) ** 2;
      ssTot += (yTrue[i] - mean) ** 2;
    }
    if (ssTot < 1e-12) return 0;
    return 1 - ssRes / ssTot;
  }

  function rmse(yTrue, yPred) {
    const n = yTrue.length;
    let s = 0;
    for (let i = 0; i < n; i++) s += (yTrue[i] - yPred[i]) ** 2;
    return Math.sqrt(s / n);
  }

  // ── Ridge regressor ─────────────────────────────────────────────────────

  /**
   * Ridge regression with polynomial features and z-score standardization.
   * Minimises  ‖y − Zw‖² + λ·n·‖w‖²  (n = number of samples; the intercept is
   * not penalised), i.e. the solution of (ZᵀZ + λ·n·R) w = Zᵀy with R the
   * identity except 0 at the bias. It is computed as ordinary least squares on
   * the stacked system [Z; √(λn)·R] via Householder QR, never forming ZᵀZ.
   */
  class RidgeRegressor {
    constructor(opts = {}) {
      this.degree = opts.degree != null ? opts.degree : 2;
      this.lambda = opts.lambda != null ? opts.lambda : 1.0;
      this.poly = new PolynomialFeatures(this.degree);
      this.scaler = null;
      this.weights = null; // length p+1, weights[0] is the intercept
    }

    /** @param {number[][]} X raw feature rows  @param {number[]} y targets */
    fit(X, y) {
      const Phi = this.poly.transformAll(X);
      this.scaler = new StandardScaler().fit(Phi);
      const Z = this.scaler.transform(Phi);

      const n = Z.length;
      const p = Z[0].length;
      const dim = p + 1; // +1 for bias

      // Build augmented system: stack [D; sqrt(lambda*n)*I_reg] rows
      // where D has a leading bias column of 1s
      const sqrtLamN = Math.sqrt(this.lambda * n); // Scale lambda by N
      const totalRows = n + p; // p regularization rows (skip intercept)
      const A = new Array(totalRows);
      const bVec = new Float64Array(totalRows);

      // Data rows
      for (let k = 0; k < n; k++) {
        const row = new Float64Array(dim);
        row[0] = 1; // bias
        for (let j = 0; j < p; j++) row[j + 1] = Z[k][j];
        A[k] = row;
        bVec[k] = y[k];
      }

      // Regularization rows (penalty on features, not intercept)
      for (let j = 0; j < p; j++) {
        const row = new Float64Array(dim);
        row[j + 1] = sqrtLamN;
        A[n + j] = row;
        // bVec[n + j] = 0 already
      }

      this.weights = solveQR(A, bVec);
      return this;
    }

    predictRow(x) {
      const phi = this.poly.transform(x);
      const z = this.scaler.transformRow(phi);
      let acc = this.weights[0];
      for (let j = 0; j < z.length; j++) acc += this.weights[j + 1] * z[j];
      return acc;
    }

    predict(X) {
      return X.map((row) => this.predictRow(row));
    }

    /** Serialize the trained model (weights + scaler) so it can persist. */
    toJSON() {
      return {
        degree: this.degree,
        lambda: this.lambda,
        weights: this.weights,
        mean: this.scaler ? this.scaler.mean : null,
        std: this.scaler ? this.scaler.std : null,
      };
    }

    /** Rebuild a predict-ready model from toJSON() output (no refit needed). */
    static fromJSON(o) {
      const r = new RidgeRegressor({ degree: o.degree, lambda: o.lambda });
      r.weights = o.weights;
      const scaler = new StandardScaler();
      scaler.mean = o.mean;
      scaler.std = o.std;
      r.scaler = scaler;
      return r;
    }
  }

  /**
   * Interleaved k-fold cross-validated R² for a given degree/lambda. This was the
   * calibration report's method until AUDIT M1: sample i goes to fold i % k, so
   * frames of the same calibration target sit in both the training and the test
   * folds, and with such correlated frames the estimate is optimistic. It is
   * kept for comparison and for data that has no target grouping.
   */
  function crossValR2(X, y, opts = {}, k = 5) {
    const n = X.length;
    if (n < k) k = Math.max(2, n);
    // Deterministic fold assignment (interleaved) so results are reproducible.
    const folds = new Array(n);
    for (let i = 0; i < n; i++) folds[i] = i % k;

    const yTrueAll = [];
    const yPredAll = [];
    for (let f = 0; f < k; f++) {
      const Xtr = [], ytr = [], Xte = [], yte = [];
      for (let i = 0; i < n; i++) {
        if (folds[i] === f) { Xte.push(X[i]); yte.push(y[i]); }
        else { Xtr.push(X[i]); ytr.push(y[i]); }
      }
      if (Xtr.length < 3 || Xte.length === 0) continue;
      const model = new RidgeRegressor(opts).fit(Xtr, ytr);
      const pred = model.predict(Xte);
      for (let i = 0; i < yte.length; i++) { yTrueAll.push(yte[i]); yPredAll.push(pred[i]); }
    }
    if (yTrueAll.length === 0) return { r2: 0, rmse: 1, method: 'interleaved' };
    return { r2: r2Score(yTrueAll, yPredAll), rmse: rmse(yTrueAll, yPredAll), method: 'interleaved' };
  }

  /**
   * Leave-one-target-out (LOTO) cross-validation (AUDIT M1). targetIndices[i]
   * says which calibration target sample i belongs to. Each fold trains on every
   * target but one and tests on the one left out, so frames of one target are
   * never on both sides.
   *
   * It needs at least three targets; with fewer, `method` is 'none' and nothing
   * is estimated. It tends to be pessimistic at the corners of the grid, where
   * the held-out target has to be extrapolated; the real yardstick is a set of
   * validation targets shown after calibration.
   *
   * @returns {{r2:number, rmse:number|null, folds:number, perTarget:Array, method:string}}
   */
  function crossValLOTO(X, y, lambda, targetIndices, degree = 2) {
    const n = X.length;
    const none = { r2: 0, rmse: null, folds: 0, perTarget: [], method: 'none' };
    if (!targetIndices || targetIndices.length !== n) return none;
    const groups = Array.from(new Set(targetIndices));
    if (groups.length < 3) return none;

    const yTrueAll = [];
    const yPredAll = [];
    const perTarget = [];
    for (const heldOut of groups) {
      const Xtr = [], ytr = [], Xte = [], yte = [];
      for (let i = 0; i < n; i++) {
        if (targetIndices[i] === heldOut) { Xte.push(X[i]); yte.push(y[i]); }
        else { Xtr.push(X[i]); ytr.push(y[i]); }
      }
      if (Xtr.length < 3 || Xte.length === 0) continue;
      const model = new RidgeRegressor({ degree, lambda }).fit(Xtr, ytr);
      const pred = model.predict(Xte);
      for (let i = 0; i < yte.length; i++) { yTrueAll.push(yte[i]); yPredAll.push(pred[i]); }
      perTarget.push({ target: heldOut, n: yte.length, rmse: rmse(yte, pred) });
    }
    if (yTrueAll.length === 0) return none;
    return { r2: r2Score(yTrueAll, yPredAll), rmse: rmse(yTrueAll, yPredAll),
             folds: perTarget.length, perTarget, method: 'loto' };
  }

  /**
   * Pick the lambda from a grid that maximizes cross-validated R². With
   * targetIndices the folds are whole targets (LOTO); without them, or with
   * fewer than three targets, they are interleaved. `method` says which was used.
   */
  function selectLambda(X, y, degree = 2, grid = [0.01, 0.05, 0.2, 1.0, 5.0, 20.0], targetIndices = null) {
    const useLoto = !!targetIndices && crossValLOTO(X, y, grid[0], targetIndices, degree).method === 'loto';
    let best = { lambda: grid[0], r2: -Infinity, rmse: Infinity, method: useLoto ? 'loto' : 'interleaved' };
    for (const lambda of grid) {
      const cv = useLoto ? crossValLOTO(X, y, lambda, targetIndices, degree) : crossValR2(X, y, { degree, lambda });
      if (cv.r2 > best.r2) best = { lambda, r2: cv.r2, rmse: cv.rmse, method: cv.method };
    }
    return best;
  }

  const api = {
    RidgeRegressor,
    PolynomialFeatures,
    StandardScaler,
    solveLinearSystem: solveQR,    // Default solver (QR, more stable)
    solveLinearSystemGJ,           // Legacy Gauss-Jordan solver
    solveQR,
    r2Score,
    rmse,
    crossValR2,
    crossValLOTO,
    selectLambda,
  };
  root.RidgeRegressor = RidgeRegressor;
  root.PolynomialFeatures = PolynomialFeatures;
  root.GazeRegressionMath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
