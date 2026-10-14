'use strict';
// Phase C: the improvements C1–C7 in the live engine. All seven are on by
// default on this branch; LumiGaze.setImprovements() switches them (for a
// comparison), and each evaluation session records which were on.
// Every landmark here is SYNTHETIC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN } = require('./helpers/engine');
const { headMatrix } = require('./helpers/landmarks');
const { makeHead } = require('./helpers/head3d');

const plain = (v) => JSON.parse(JSON.stringify(v));
const NAMES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const ALL = Object.fromEntries(NAMES.map((n) => [n, true]));
const NONE = Object.fromEntries(NAMES.map((n) => [n, false]));

/** One camera frame from given landmarks and head matrix. */
function show(ctx, lm, matrix) {
  ctx.env.clock.advance(33);
  ctx.gaze._onFrame({ faceLandmarks: [lm], facialTransformationMatrixes: [matrix] });
  return plain(ctx.gaze.lastFrameInfo);
}

test('all seven are on by default, and evalFlags() reports them for the session record', () => {
  const { gaze } = setupEngine();
  assert.deepEqual(plain(gaze.improvements), ALL);
  const flags = gaze.evalFlags();
  assert.deepEqual(plain(flags), ALL);
  flags.C1 = false;
  assert.equal(gaze.improvements.C1, true, 'a copy: the caller cannot switch one off by accident');
});

test('setImprovements switches them; an unknown name, or a switch during calibration, is refused', () => {
  const { gaze } = setupEngine({ calibrated: false });
  assert.deepEqual(plain(gaze.setImprovements(['C2', 'C6'])), { ...NONE, C2: true, C6: true });
  assert.throws(() => gaze.setImprovements(['C9']), /C9/);
  assert.equal(gaze.improvements.C2, true, 'a refused change leaves them as they were');
  gaze.startCalibration(5);
  assert.throws(() => gaze.setImprovements('all'), /calibrat/i);
  assert.deepEqual(plain(gaze.improvements), { ...NONE, C2: true, C6: true });
});

test('C1: the engine measures the eyes in the head frame, with the camera picture\'s aspect ratio', () => {
  const ctx = setupEngine({ calibrated: false });
  const F = ctx.env.get('GazeFeatures');
  const head = makeHead({ aspect: 4 / 3 });
  const { lm, matrix } = head.frame({ target: { x: 0.3, y: 0.6 }, yaw: 8 });
  const optionsFor = (aspect) => ({ ...F.improvementOptions(F.flags('all')).features, aspect });

  // Before the camera reports its size: 16:9, what the engine asks the camera for.
  assert.deepEqual(show(ctx, lm, matrix).features, plain(F.extract(lm, matrix, ctx.store.settings, optionsFor(16 / 9)).features));
  ctx.gaze.videoElement = { videoWidth: 640, videoHeight: 480 };
  const on = show(ctx, lm, matrix).features;
  assert.deepEqual(on, plain(F.extract(lm, matrix, ctx.store.settings, optionsFor(4 / 3)).features));
  assert.deepEqual(on.slice(4, 7), [0, 0, 0], 'the head angles are folded into the eye features');

  ctx.gaze.setImprovements('none');
  const off = show(ctx, lm, matrix).features;
  assert.deepEqual(off, plain(F.extract(lm, matrix, ctx.store.settings).features), 'off: the Phase B features');
  assert.ok(Math.abs(off[4] - 8) < 0.5, 'with the head turn as a feature of its own');
});

test('C2: eyes open for the alarm but narrower than 0.16 give no gaze point, and are not taken as closed', () => {
  const ctx = setupEngine({ settings: { earThreshold: 0.12 } });
  const updates = [];
  ctx.gaze.onGazeUpdate = (x, y, eye, state) => updates.push(state);
  feedFrames(ctx, 500, { openL: 0.14, openR: 0.14 });
  const info = plain(ctx.gaze.lastFrameInfo);
  assert.equal(info.reason, 'eyes_narrow');
  assert.equal(info.gaze, null);
  assert.ok(info.eyes.every((e) => e.open), 'open by the caregiver\'s threshold');
  assert.equal(ctx.gaze.eyesClosedSince, null, 'the eyes-closed alarm is not started');
  assert.equal(updates.at(-1), 'Eyes too narrow');

  ctx.gaze.setImprovements('none');
  const off = show(ctx, require('./helpers/landmarks').faceLandmarks({ openL: 0.14, openR: 0.14 }), headMatrix());
  assert.notEqual(off.reason, 'eyes_narrow');
  assert.ok(off.features, 'off: the same eyes give a gaze point');
});

test('C3, C4, C5 and C1: a calibration run gets the options, and frames the settle guard drops are not marked as samples', () => {
  const ctx = setupEngine({ calibrated: false });
  const options = (run) => [run.strictOutliers, run.settleMs, run.degreeOption, run.featureSet, run.stdFloorRatio];
  ctx.gaze.startCalibration(5);
  const run = ctx.gaze._calibRun;
  assert.deepEqual(options(run), [true, 300, 'auto', 'head', 0.05]);
  feedFrames(ctx, 264, EYES_OPEN);                       // 8 frames, all inside the first 300 ms
  assert.equal(run.sampleCount(), 0);
  assert.equal(ctx.gaze.lastFrameInfo.calSample, false, 'not a calibration sample: the guard dropped it');
  feedFrames(ctx, 99, EYES_OPEN);                        // 297 ms (dropped), 330 and 363 ms (kept)
  assert.equal(run.sampleCount(), 2);
  assert.equal(ctx.gaze.lastFrameInfo.calSample, true);
  feedFrames(ctx, 500, EYES_OPEN);
  assert.equal(ctx.gaze.captureCalibrationPoint().done, false);
  feedFrames(ctx, 264, EYES_OPEN);
  assert.equal(run.sampleCount(), 0, 'the wait starts again when the next target appears');

  ctx.gaze.cancelCalibration();
  ctx.gaze.setImprovements('none');
  ctx.gaze.startCalibration(5);
  assert.deepEqual(options(ctx.gaze._calibRun), [false, 0, 2, 'image', 0], 'off: the Phase B calibration');
});

test('C1: the uncalibrated cursor still follows the iris-in-eye ratio, as before', () => {
  const ctx = setupEngine({ calibrated: false });
  const { faceLandmarks } = require('./helpers/landmarks');
  const lm = faceLandmarks({ irisX: 0.35, irisY: 0.7 });
  const on = show(ctx, lm, headMatrix());
  ctx.gaze.setImprovements('none');
  const off = show(ctx, lm, headMatrix());
  assert.deepEqual(on.pred, off.pred);
  assert.ok(off.pred.y > 600, 'looking down moves the cursor down');
});

test('C6: the smoother is told each frame\'s confidence', () => {
  const ctx = setupEngine();
  assert.equal(ctx.gaze.stabilizer.confidenceWeighting, true);
  const seen = [];
  const original = ctx.gaze.stabilizer.process.bind(ctx.gaze.stabilizer);
  ctx.gaze.stabilizer.process = (x, y, t, c) => { seen.push(c); return original(x, y, t, c); };
  const { faceLandmarks } = require('./helpers/landmarks');
  show(ctx, faceLandmarks(), headMatrix(30, 0));          // a turned head lowers the confidence
  assert.equal(seen.length, 1);
  assert.ok(seen[0] < 1 && seen[0] === ctx.gaze.lastConfidence, `confidence ${seen[0]}`);
  ctx.gaze.setImprovements('none');
  feedFrames(ctx, 33, EYES_OPEN);
  assert.equal(ctx.gaze.stabilizer.confidenceWeighting, false);
});

/** A small trained calibration of the given feature set, as LumiStore would hold it. */
function savedCalibration(ctx, featureSet) {
  const Cal = ctx.env.get('GazeCalibration');
  const cal = new Cal({ featureSet });
  let target = cal.begin(5, 0), k = 0;
  while (target) {
    for (let i = 0; i < 15; i++) {
      const n = Math.sin(++k) * 1e-3;
      cal.addSample([0.5 - 0.3 * (target.x - 0.5) + n, 0.5 + 0.3 * (target.y - 0.5) - n, 0.5, 0.5, n, -n, 0, 0.3, 0.1 + n, 0.1 - n], 0);
    }
    target = cal.commitPoint(0).next;
  }
  assert.equal(cal.train({ width: 1440, height: 900 }).ok, true);
  return plain(cal.toJSON());
}

test('a saved calibration is used only with the features it was made from; otherwise the caregiver is asked to recalibrate', () => {
  const ctx = setupEngine({ calibrated: false });
  const statuses = [];
  ctx.gaze.onStatusUpdate = (m) => statuses.push(m);
  const image = savedCalibration(ctx, 'image'), head = savedCalibration(ctx, 'head');
  assert.deepEqual([image.version, head.version], [3, 4]);

  ctx.store.getCalibration = () => image;                 // made before Phase C
  assert.equal(ctx.gaze._restoreSavedCalibration(), false);
  assert.equal(ctx.gaze.isCalibrated, false);
  assert.match(statuses.at(-1), /different gaze settings.*recalibrate/i);

  ctx.store.getCalibration = () => head;
  assert.equal(ctx.gaze._restoreSavedCalibration(), true);
  assert.equal(ctx.gaze.isCalibrated, true);
  assert.equal(ctx.gaze.calibration.featureSet, 'head');

  // Switching C1 off: the head-frame calibration no longer fits.
  ctx.gaze.setImprovements('none');
  assert.equal(ctx.gaze.isCalibrated, false);
  assert.equal(ctx.gaze.calibration, null);
  assert.match(statuses.at(-1), /recalibrate/i);

  // A switch that keeps the feature set keeps the calibration in use.
  ctx.store.getCalibration = () => image;
  ctx.gaze.setImprovements(['C2']);
  assert.equal(ctx.gaze.isCalibrated, true, 'the saved Phase B calibration fits again');
  const inUse = ctx.gaze.calibration;
  ctx.gaze.setImprovements(['C2', 'C3', 'C6']);
  assert.equal(ctx.gaze.calibration, inUse);

  // Nothing saved: the caregiver is still told why the calibration stopped.
  ctx.store.getCalibration = () => null;
  statuses.length = 0;
  ctx.gaze.setImprovements('all');
  assert.equal(ctx.gaze.isCalibrated, false);
  assert.match(statuses.at(-1) || '', /recalibrate/i);

  ctx.store.getCalibration = () => ({ version: 2 });     // far older format
  ctx.gaze.calibration = null; ctx.gaze.isCalibrated = false;
  assert.equal(ctx.gaze._restoreSavedCalibration(), false, 'refused without crashing');
  assert.match(statuses.at(-1), /out of date/i);
});

test('an evaluation session records which improvements were on', () => {
  const { setupWizard } = require('./helpers/wizard');
  const w = setupWizard();
  w.el.evalStartBtn.click();
  assert.equal(w.runUntil('calibration'), true);
  assert.deepEqual(plain(w.wizard.recorder.session.engine.flags), ALL);
});
