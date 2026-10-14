'use strict';
// Phase C: seven candidate accuracy changes (C1–C7). Each has its own switch,
// so the replay can score every one separately against the Phase B baseline,
// and with all switches off the gaze code behaves exactly as in Phase B.
//
// These tests show that each MECHANISM works, on synthetic data. They do not
// show that a change improves accuracy for a person: that needs recorded sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../gaze/gaze-features.js');
const RMath = require('../gaze/ridge-regression.js');
const { GazeCalibration, rejectOutliers } = require('../gaze/gaze-calibration.js');

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
}

// ── The switches ────────────────────────────────────────────────────

test('switches: one per change, and all off is the Phase B behaviour', () => {
  assert.deepEqual(Object.keys(F.IMPROVEMENTS), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
  assert.deepEqual(F.improvementOptions(F.flags('none')), {
    features: { headFrame: false, headGain: 0, earFloor: 0, softEar: false },
    calibration: { strictOutliers: false, settleMs: 0, degree: 2, stdFloorRatio: 0, featureSet: 'image' },
    stabilizer: { confidenceWeighting: false },
    drift: { mode: 'legacy' },
  });
  const all = F.improvementOptions(F.flags('all'));
  assert.equal(all.features.headFrame, true);
  assert.equal(all.features.earFloor, 0.16);
  assert.equal(all.calibration.strictOutliers, true);
  assert.equal(all.calibration.settleMs, 300);
  assert.equal(all.calibration.degree, 'auto');
  assert.equal(all.calibration.featureSet, 'head');
  assert.equal(all.stabilizer.confidenceWeighting, true);
  assert.equal(all.drift.mode, 'bias');
  // Each switch changes only its own options.
  const only3 = F.improvementOptions(F.flags(['C3']));
  assert.equal(only3.calibration.strictOutliers, true);
  assert.deepEqual({ ...only3, calibration: { ...only3.calibration, strictOutliers: false } }, F.improvementOptions(F.flags('none')));
  assert.deepEqual(F.flags(['C1', 'C6']), { C1: true, C2: false, C3: false, C4: false, C5: false, C6: true, C7: false });
  assert.throws(() => F.flags(['C9']), /C9/);
});

// ── C3: the outlier filter's gap ────────────────────────────────────

/** 30 clean frames of one target plus `n` frames disturbed in the given features. */
function withDisturbed(dims, n = 6, seed = 7) {
  const rand = rng(seed);
  const clean = () => [0.5, 0.5, 0.5, 0.5, 2, -3, 1, 0.28, 0.12, 0.11].map((v) => v + rand() * 0.004);
  const bad = Array.from({ length: n }, () => { const row = clean(); for (const d of dims) row[d] += 0.1; return row; });
  return { samples: [...Array.from({ length: 30 }, clean), ...bad], bad };
}

test('C3: a frame disturbed in 3 of 10 features (ly, ry, ear) is rejected', () => {
  const { samples, bad } = withDisturbed([1, 3, 7]);
  const keptBy = (strict) => bad.filter((b) => rejectOutliers(samples, 1000, strict).includes(b)).length;
  assert.equal(keptBy(false), 6, 'Phase B: all six pass as clean (the gap found in Phase A)');
  assert.equal(keptBy(true), 0, 'with C3 they are dropped');
  // Two disturbed features are still tolerated, so ordinary frames are not thrown away.
  const two = withDisturbed([1, 3]);
  assert.equal(two.bad.filter((b) => rejectOutliers(two.samples, 1000, true).includes(b)).length, 6);
  const clean = withDisturbed([], 0);
  assert.ok(rejectOutliers(clean.samples, 1000, true).length >= 27, 'clean frames are kept');
});

test('C3: the calibration uses the stricter filter only when switched on', () => {
  const run = (strictOutliers) => {
    const cal = new GazeCalibration({ strictOutliers, maxSamplesPerPoint: 100 });   // no thinning: only the filter counts
    cal.begin(5, 0);
    for (const row of withDisturbed([1, 3, 7]).samples) cal.addSample(row, 1000);
    return cal.commitPoint(2000);
  };
  assert.deepEqual([run(false).rejected, run(true).rejected], [0, 6]);
});

// ── C4: settle guard ────────────────────────────────────────────────

const ROW = [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.28, 0.12, 0.11];

test('C4: samples in the first 300 ms after a target change are ignored', () => {
  const cal = new GazeCalibration({ settleMs: 300 });
  cal.begin(5, 1000);                                  // the first target appears at t = 1000
  for (const t of [1010, 1150, 1299]) cal.addSample(ROW, t);
  assert.equal(cal.sampleCount(), 0, 'the eye is still travelling');
  for (const t of [1300, 1400, 1500]) cal.addSample(ROW, t);
  assert.equal(cal.sampleCount(), 3);
  cal.commitPoint(2000);                               // the next target appears at t = 2000
  cal.addSample(ROW, 2100);
  assert.equal(cal.sampleCount(), 0, 'the guard applies to every target');
  cal.addSample(ROW, 2300);
  assert.equal(cal.sampleCount(), 1);
});

test('C4: discarding the buffer empties it without starting a second wait', () => {
  const cal = new GazeCalibration({ settleMs: 300 });
  cal.begin(5, 1000);
  for (const t of [1350, 1450]) cal.addSample(ROW, t);
  cal.discardCurrentSamples();                         // what the app does at 500 ms
  assert.equal(cal.sampleCount(), 0);
  cal.addSample(ROW, 1510);
  assert.equal(cal.sampleCount(), 1, 'collection continues at once');
});

test('C4: switched off, every sample counts (Phase B)', () => {
  const cal = new GazeCalibration();
  cal.begin(5, 1000);
  cal.addSample(ROW, 1001);
  assert.equal(cal.sampleCount(), 1);
});

// ── C5: degree 1 or degree 2 ────────────────────────────────────────

/** A synthetic calibration: iris ratio follows the target linearly, or with a bend. */
function calibrate(opts, { points = 9, bend = 0, seed = 3, fixationSd = 0.01 } = {}) {
  const rand = rng(seed);
  const feature = (tx, ty, fx, fy) => {
    const lx = 0.5 - 0.3 * (tx - 0.5) + bend * (tx - 0.5) ** 2 + fx + rand() * 0.002;
    const ly = 0.5 + 0.3 * (ty - 0.5) + bend * (ty - 0.5) ** 2 + fy + rand() * 0.002;
    return [lx, ly, lx + rand() * 0.002, ly + rand() * 0.002, rand() * 0.3, rand() * 0.3, rand() * 0.3, 0.28 + rand() * 0.005, 0.12 + rand() * 0.0005, 0.1 + rand() * 0.0005];
  };
  const cal = new GazeCalibration(opts);
  let t = cal.begin(points, 0);
  while (t) {
    const fx = rand() * fixationSd, fy = rand() * fixationSd;
    for (let i = 0; i < 20; i++) cal.addSample(feature(t.x, t.y, fx, fy), 1000);
    t = cal.commitPoint(2000).next;
  }
  const report = cal.train({ width: 1440, height: 900 });
  /** Mean error (px) on targets the model never saw. */
  const heldOut = () => {
    let sum = 0, n = 0;
    for (const tx of [0.2, 0.4, 0.6, 0.8]) for (const ty of [0.25, 0.5, 0.75]) {
      const p = cal.predict(feature(tx, ty, 0, 0));
      sum += Math.hypot((p.x - tx) * 1440, (p.y - ty) * 900); n++;
    }
    return sum / n;
  };
  return { cal, report, heldOut };
}

test('C5: degree 1 has 11 weights per axis, degree 2 has 66; both train and predict', () => {
  const linear = calibrate({ degree: 1 }), quadratic = calibrate({ degree: 2 });
  assert.equal(linear.cal.modelX.weights.length, 11);
  assert.equal(quadratic.cal.modelX.weights.length, 66);
  assert.equal(linear.report.degree, 1);
  assert.equal(quadratic.report.degree, 2);
  for (const run of [linear, quadratic]) {
    assert.equal(run.report.ok, true);
    assert.ok(run.heldOut() > 0 && run.heldOut() < 200, `held-out error ${run.heldOut().toFixed(1)} px`);
  }
});

test('C5: "auto" fits both and keeps the one with the lower leave-one-target-out error', () => {
  const straight = calibrate({ degree: 'auto' });                 // a linear eye: 9 targets cannot justify 66 weights
  assert.equal(straight.report.degree, 1);
  assert.deepEqual(Object.keys(straight.report.degreeChoice), ['1', '2']);
  assert.ok(straight.report.degreeChoice[1] <= straight.report.degreeChoice[2]);
  assert.equal(straight.cal.modelX.weights.length, 11);
  const bent = calibrate({ degree: 'auto' }, { points: 25, bend: 0.25 });   // a clearly curved mapping, many targets
  assert.equal(bent.report.degree, 2);
  assert.equal(bent.cal.modelX.weights.length, 66);
  // The stored calibration remembers which degree it is.
  const restored = GazeCalibration.fromJSON(straight.cal.toJSON());
  assert.equal(restored.degree, 1);
  assert.deepEqual(restored.predict(ROW), straight.cal.predict(ROW));
});

test('C5: degree 1 uses a lambda grid of its own', () => {
  assert.deepEqual(RMath.lambdaGrid(2), [0.01, 0.05, 0.2, 1.0, 5.0, 20.0]);
  assert.ok(Math.max(...RMath.lambdaGrid(1)) < Math.max(...RMath.lambdaGrid(2)), 'fewer weights need less shrinking');
  assert.equal(calibrate({ degree: 1 }).report.ok, true);
});

// ── C6: confidence-weighted smoothing ───────────────────────────────
const { GazeStabilizer } = require('../gaze/gaze-stabilizer.js');

/** The first output after a small jump (the size of landmark noise), at a given confidence. */
function stepResponse(opts, confidence, step = 8) {
  const s = new GazeStabilizer({ width: 1440, height: 900, ...GazeStabilizer.paramsFor(0.35), ...opts });
  let t = 0;
  for (let i = 0; i < 15; i++) s.process(500, 400, (t += 33), confidence);
  return s.process(500 + step, 400, (t += 33), confidence).x - 500;
}

test('C6: low-confidence frames are smoothed more (a smaller response to the same jump)', () => {
  const sure = stepResponse({ confidenceWeighting: true }, 1.0);
  const unsure = stepResponse({ confidenceWeighting: true }, 0.3);
  assert.ok(sure > 0, `confident frame moves ${sure.toFixed(2)} px`);
  assert.ok(unsure < sure * 0.75, `unsure frame moves ${unsure.toFixed(2)} px, confident ${sure.toFixed(2)} px`);
});

test('C6: at full confidence, or switched off, the smoothing is exactly Phase B', () => {
  assert.equal(stepResponse({ confidenceWeighting: true }, 1.0), stepResponse({}, 1.0));
  assert.equal(stepResponse({}, 0.3), stepResponse({}, 1.0), 'switched off, confidence is ignored');
});

test('C6: the weighting never compounds: the filter returns to normal when confidence recovers', () => {
  const s = new GazeStabilizer({ width: 1440, height: 900, ...GazeStabilizer.paramsFor(0.35), confidenceWeighting: true });
  const base = GazeStabilizer.paramsFor(0.35).minCutoff;
  let t = 0;
  for (let i = 0; i < 50; i++) s.process(500, 400, (t += 33), 0.3);
  assert.ok(Math.abs(s.euro.fx.minCutoff - base * 0.3) < 1e-12, 'scaled once, not 50 times');
  s.process(500, 400, (t += 33), 1.0);
  assert.equal(s.euro.fx.minCutoff, base);
  s.setParams(GazeStabilizer.paramsFor(0.06));
  s.process(500, 400, (t += 33), 0.5);
  assert.ok(Math.abs(s.euro.fx.minCutoff - GazeStabilizer.paramsFor(0.06).minCutoff * 0.5) < 1e-12, 'and follows a new setting');
});

// ── C7: drift detector ──────────────────────────────────────────────
const { DriftDetector } = require('../gaze/drift-detector.js');

const KEY = { x: 600, y: 400 }, KEY_SIZE = { width: 132, height: 148 };
/** Dwells whose gaze point sits (dx, dy) px from the key centre, plus a little scatter. */
function dwells(detector, n, dx, dy, seed = 1) {
  const rand = rng(seed);
  const flags = [];
  for (let i = 0; i < n; i++) {
    flags.push(detector.onDwellActivate({ x: KEY.x + dx + rand() * 12, y: KEY.y + dy + rand() * 12 }, KEY, KEY_SIZE));
  }
  return flags;
}

test('C7: six dwells in a row off to the same side ask for recalibration', () => {
  const d = new DriftDetector({ mode: 'bias' });
  const flags = dwells(d, 6, 40, 0);                   // the estimate sits 40 px right of where the keys are
  assert.deepEqual(flags.slice(0, 5), [false, false, false, false, false]);
  assert.equal(flags[5], true);
  assert.equal(d.last.reason, 'consistent-x');
  assert.ok(d.last.biasX > 0.2);
});

test('C7: also downwards, and after a run of accurate dwells (the case audit M10 found missed)', () => {
  const d = new DriftDetector({ mode: 'bias' });
  assert.ok(!dwells(d, 20, 0, 0, 3).some(Boolean), 'accurate dwells, scattered around the centre: no warning');
  const later = dwells(d, 10, 0, 35, 4);               // then it drifts downwards
  assert.ok(later.some(Boolean), 'flagged within 10 dwells');
  assert.ok(later.indexOf(true) <= 5);
  const legacy = new DriftDetector();                  // the Phase B detector
  dwells(legacy, 20, 0, 0, 3);
  assert.ok(!dwells(legacy, 10, 0, 35, 4).some(Boolean), 'the Phase B rule misses it');
});

test('C7: a warning is given once, then the detector starts over', () => {
  const d = new DriftDetector({ mode: 'bias' });
  const flags = dwells(d, 12, -40, 0);
  assert.deepEqual(flags.map((f, i) => (f ? i : null)).filter((i) => i !== null), [5, 11]);
  d.reset();
  assert.equal(dwells(d, 3, -40, 0).some(Boolean), false);
});

test('C7: switched off, the detector is the Phase B one', () => {
  const a = new DriftDetector(), b = new DriftDetector({ mode: 'legacy' });
  const point = { x: 670, y: 400 };
  for (let i = 0; i < 15; i++) assert.equal(a.onDwellActivate(point, KEY, KEY_SIZE), b.onDwellActivate(point, KEY, KEY_SIZE));
});
