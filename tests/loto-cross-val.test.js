'use strict';
// AUDIT M1: the calibration quality report used interleaved k-fold
// cross-validation, so near-identical frames of one target sat in both the
// training and the test folds and the estimate was optimistic. It now leaves
// one whole target out at a time (leave-one-target-out, LOTO).
const test = require('node:test');
const assert = require('node:assert/strict');
const RMath = require('../gaze/ridge-regression.js');
const { GazeCalibration } = require('../gaze/gaze-calibration.js');

/** Deterministic pseudo-random numbers in [-1, 1). */
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
}

/**
 * Synthetic calibration data with TARGET-CORRELATED noise: every look at a
 * target lands slightly off it (a fixation error shared by all its frames),
 * plus a little per-frame jitter. This is what real fixations look like and it
 * is exactly what interleaved folds cannot see. Rows are the engine's 10 features.
 */
function grid(points, seed, { fixationSd = 0.06, frameSd = 0.004, frames = 20 } = {}) {
  const rand = rng(seed);
  const X = [], y = [], targets = [];
  points.forEach(([tx, ty], t) => {
    const fixX = rand() * fixationSd, fixY = rand() * fixationSd;
    for (let i = 0; i < frames; i++) {
      const lx = 0.5 - 0.3 * (tx - 0.5) + fixX + rand() * frameSd;
      const ly = 0.5 + 0.3 * (ty - 0.5) + fixY + rand() * frameSd;
      X.push([lx, ly, lx + rand() * frameSd, ly + rand() * frameSd, rand() * 0.3, rand() * 0.3, rand() * 0.3,
              0.28 + rand() * 0.005, 0.12 + rand() * 0.001, 0.1 + rand() * 0.001]);
      y.push(tx);
      targets.push(t);
    }
  });
  return { X, y, targets };
}

const NINE = [0.08, 0.5, 0.92].flatMap((y) => [0.08, 0.5, 0.92].map((x) => [x, y]));
const FRESH = [0.2, 0.4, 0.6, 0.8].flatMap((y) => [0.15, 0.35, 0.65, 0.85].map((x) => [x, y]));
const LAMBDA = 0.2, DEGREE = 2;

test('crossValLOTO(X, y, lambda, targetIndices) holds out one whole target per fold', () => {
  const { X, y, targets } = grid(NINE, 7);
  const cv = RMath.crossValLOTO(X, y, LAMBDA, targets, DEGREE);
  assert.equal(cv.method, 'loto');
  assert.equal(cv.folds, 9);
  assert.equal(cv.perTarget.length, 9);
  assert.ok(cv.perTarget.every((p) => p.n === 20 && p.rmse >= 0));
  assert.ok(Number.isFinite(cv.r2) && Number.isFinite(cv.rmse));
});

test('interleaved folds are optimistic; LOTO errs on the safe side (10 synthetic calibrations)', () => {
  // Honest scope: LOTO is NOT the true error either. It is pessimistic, because a
  // held-out corner target has to be extrapolated. The true yardstick is a set of
  // validation targets shown after calibration (the evaluation wizard).
  const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => {
    const { X, y, targets } = grid(NINE, seed);
    const model = new RMath.RidgeRegressor({ degree: DEGREE, lambda: LAMBDA }).fit(X, y);
    const fresh = grid(FRESH, seed + 1000);                       // targets the model never saw
    return {
      truth: RMath.rmse(fresh.y, model.predict(fresh.X)),
      interleaved: RMath.crossValR2(X, y, { degree: DEGREE, lambda: LAMBDA }, 5).rmse,
      loto: RMath.crossValLOTO(X, y, LAMBDA, targets, DEGREE).rmse,
    };
  });
  const mean = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  const show = `interleaved ${mean('interleaved').toFixed(4)}, true ${mean('truth').toFixed(4)}, LOTO ${mean('loto').toFixed(4)}`;
  assert.ok(mean('interleaved') < mean('truth'), `the interleaved estimate is below the true error: ${show}`);
  assert.ok(mean('loto') > mean('truth'), `the LOTO estimate is above the true error: ${show}`);
  assert.ok(runs.every((r) => r.loto > r.interleaved), 'LOTO is never the more optimistic of the two');
});

test('with fewer than three targets LOTO is not possible, and says so', () => {
  const { X, y, targets } = grid([[0.2, 0.5], [0.8, 0.5]], 3);
  const cv = RMath.crossValLOTO(X, y, LAMBDA, targets, DEGREE);
  assert.equal(cv.method, 'none');
  assert.equal(cv.folds, 0);
});

test('selectLambda can choose by either method', () => {
  const { X, y, targets } = grid(NINE, 11);
  const byLoto = RMath.selectLambda(X, y, DEGREE, undefined, targets);
  const byInterleaved = RMath.selectLambda(X, y, DEGREE);
  assert.equal(byLoto.method, 'loto');
  assert.equal(byInterleaved.method, 'interleaved');
  assert.ok(byLoto.rmse >= byInterleaved.rmse);
});

function calibrate(opts, seed = 5) {
  const rand = rng(seed);
  const cal = new GazeCalibration(opts);
  let t = cal.begin(9);
  while (t) {
    const fixX = rand() * 0.05, fixY = rand() * 0.05;
    for (let i = 0; i < 20; i++) {
      const lx = 0.5 - 0.3 * (t.x - 0.5) + fixX + rand() * 0.003, ly = 0.5 + 0.3 * (t.y - 0.5) + fixY + rand() * 0.003;
      cal.addSample([lx, ly, lx, ly, rand() * 0.2, rand() * 0.2, rand() * 0.2, 0.28 + rand() * 0.004, 0.12, 0.1]);
    }
    t = cal.commitPoint().next;
  }
  return { cal, report: cal.train({ width: 1440, height: 900 }) };
}

test('calibration: the quality report uses LOTO by default and says which method it used', () => {
  const { cal, report } = calibrate();
  assert.equal(report.ok, true);
  assert.equal(report.cvMethod, 'loto');
  assert.equal(cal.trainTargetIndices.length, cal.trainX.length);
  assert.ok(report.rmseXPx > 0 && report.rmseYPx > 0, 'the estimate is reported for x and y separately');
  assert.ok(Math.abs(report.accuracyPx - Math.round(Math.hypot(report.rmseXPx, report.rmseYPx))) <= 1);
});

test('calibration: the old interleaved method is still available, for comparison only', () => {
  const loto = calibrate({ cv: 'loto' }).report;
  const old = calibrate({ cv: 'interleaved' }).report;
  assert.equal(old.cvMethod, 'interleaved');
  assert.ok(loto.accuracyPx > old.accuracyPx, `LOTO ${loto.accuracyPx} px should exceed interleaved ${old.accuracyPx} px`);
});

test('calibration: the final model is fitted on all the clean samples', () => {
  const { cal } = calibrate();
  const direct = new RMath.RidgeRegressor({ degree: cal.degree, lambda: cal.report.lambdaX }).fit(cal.trainX, cal.trainYx);
  const f = cal.trainX[7];
  assert.equal(cal.modelX.predictRow(f), direct.predictRow(f));
});
