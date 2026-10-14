const test = require('node:test');
const assert = require('node:assert');
const GazeRegressionMath = require('../gaze/ridge-regression.js');
const { RidgeRegressor } = GazeRegressionMath;
const { GazeCalibration } = require('../gaze/gaze-calibration.js');

test('LOTO cross-validation provides an honest estimate on correlated grouped data (AUDIT M1)', () => {
  // Synthesize targets where each target has multiple near-duplicate samples (correlated frames)
  // plus some target-specific offset/noise that makes extrapolating to unseen targets harder.
  const numTargets = 9;
  const samplesPerTarget = 20;
  const X = [];
  const y = [];
  const targetIndices = [];

  // Deterministic PRNG
  let seed = 42;
  function rnd() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function noise(s) { return (rnd() - 0.5) * 2 * s; }

  for (let t = 0; t < numTargets; t++) {
    const tx = 0.1 + (t % 3) * 0.4;
    const ty = 0.1 + Math.floor(t / 3) * 0.4;
    // Base feature for this target
    const baseF = [tx * 0.8 + 0.1, ty * 0.7 + 0.15];
    // Add target-specific distortion
    const targetNoise = noise(0.08);

    for (let s = 0; s < samplesPerTarget; s++) {
      // Tiny frame jitter within target
      const frameJitter = [noise(0.005), noise(0.005)];
      const sample = [baseF[0] + frameJitter[0], baseF[1] + frameJitter[1]];
      X.push(sample);
      y.push(tx + targetNoise + noise(0.005));
      targetIndices.push(t);
    }
  }

  // Interleaved k-fold CV leaks samples from the same target into both train & test folds
  const interleaved = GazeRegressionMath.crossValR2(X, y, { degree: 1, lambda: 0.1 }, 5);
  // LOTO holds out the entire target
  const loto = GazeRegressionMath.crossValLOTO(X, y, targetIndices, { degree: 1, lambda: 0.1 });

  // Interleaved should be artificially optimistic (higher R^2, lower RMSE)
  // because near-identical copies of test frames were in the training set
  assert.ok(
    interleaved.r2 > loto.r2,
    `Interleaved R2 (${interleaved.r2.toFixed(3)}) should be higher/more optimistic than LOTO (${loto.r2.toFixed(3)})`
  );
  assert.ok(
    loto.rmse > interleaved.rmse,
    `LOTO RMSE (${loto.rmse.toFixed(3)}) should be larger/more honest than interleaved (${interleaved.rmse.toFixed(3)})`
  );
});

test('GazeCalibration records trainTargetIndices and sets cvMethod to loto', () => {
  const cal = new GazeCalibration({ maxSamplesPerPoint: 10 });
  let t = cal.begin(5);
  while (t) {
    for (let i = 0; i < 15; i++) {
      cal.addSample([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.3, 0.1, 0.1]);
    }
    const res = cal.commitPoint();
    t = res.next;
  }
  const report = cal.train({ width: 1000, height: 1000 });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.cvMethod, 'loto');
  assert.strictEqual(cal.trainTargetIndices.length, cal.trainX.length);
});
