'use strict';
// AUDIT M5 (gaze clicks active before calibration) and M6 (cancelling or
// failing a recalibration discarded the working model; any result — even
// "Poor" — was saved immediately, before the caregiver accepted it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN } = require('./helpers/engine');

/** Run a full synthetic calibration: features move with the target, so training succeeds. */
function runCalibration({ gaze, env }, points = 9) {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  let target = gaze.startCalibration(points);
  let result = null;
  while (target) {
    env.clock.advance(500);            // the app waits for the eye to land (and C4 ignores the first 300 ms)
    for (let i = 0; i < 20; i++) {
      const lx = 0.5 + (target.x - 0.5) * 0.08 + rnd() * 0.004;
      const ly = 0.5 + (target.y - 0.5) * 0.05 + rnd() * 0.004;
      gaze._calibRun.addSample([lx, ly, lx, ly, rnd(), rnd(), rnd(), 0.28, 0.12, 0.10]);
    }
    result = gaze.captureCalibrationPoint();
    target = result.done ? null : result.target;
  }
  return result;
}

test('M5: without a calibration, a steady gaze does not click anything', () => {
  const ctx = setupEngine({ calibrated: false });
  const states = [];
  ctx.gaze.onGazeUpdate = (x, y, eye, state) => states.push(state);
  feedFrames(ctx, 5000, EYES_OPEN);
  assert.equal(ctx.fired.length, 0);
  assert.equal(states.at(-1), 'uncalibrated', 'the UI is told why clicks are off');
});

test('M5: with a calibration, the same gaze clicks', () => {
  const ctx = setupEngine({ calibrated: true });
  feedFrames(ctx, 3000, EYES_OPEN);
  assert.equal(ctx.fired.length, 1);
});

test('M6: cancelling a recalibration keeps the calibration in use', () => {
  const ctx = setupEngine({ calibrated: true });
  const previous = ctx.gaze.calibration;
  ctx.gaze.startCalibration(9);
  ctx.gaze.cancelCalibration();
  assert.equal(ctx.gaze.calibration, previous);
  assert.equal(ctx.gaze.isCalibrated, true);
});

test('M6: a new calibration is not used or saved until it is accepted', () => {
  const ctx = setupEngine({ calibrated: true });
  const previous = ctx.gaze.calibration;
  const result = runCalibration(ctx);
  assert.equal(result.report.ok, true);
  assert.equal(ctx.gaze.calibration, previous, 'still the previous model');
  assert.equal(ctx.store.saved, undefined, 'nothing saved yet');
  assert.equal(ctx.gaze.acceptCalibration(), true);
  assert.notEqual(ctx.gaze.calibration, previous);
  assert.equal(ctx.store.saved.version, 4, 'saved once accepted (version 4: head-frame features, C1)');
});

test('M6: choosing Recalibrate discards the new result and keeps the old model', () => {
  const ctx = setupEngine({ calibrated: true });
  const previous = ctx.gaze.calibration;
  runCalibration(ctx);
  ctx.gaze.discardCalibration();
  assert.equal(ctx.gaze.acceptCalibration(), false, 'nothing left to accept');
  assert.equal(ctx.gaze.calibration, previous);
  assert.equal(ctx.store.saved, undefined);
});
