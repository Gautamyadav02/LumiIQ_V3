'use strict';
// Phase A (diagnosis): a passive per-frame record of what the engine detected
// and why a frame did or did not produce a gaze point, for the caregiver's
// overlay and statistics. It must describe the pipeline truthfully and change
// nothing in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');
const { faceLandmarks } = require('./helpers/landmarks');

/** Head turned `deg` degrees about the vertical axis (column-major 4×4, as MediaPipe gives it). */
function yawMatrix(deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { data: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] };
}

function lastInfo(ctx) {
  const info = ctx.gaze.lastFrameInfo;
  assert.ok(info, 'the engine records the last frame');
  return JSON.parse(JSON.stringify(info));   // copy out of the test realm
}

test('a frame without a face is recorded as "no_face", with no gaze point', () => {
  const ctx = setupEngine();
  ctx.env.clock.advance(33);
  ctx.gaze._onFrame({ faceLandmarks: [] });
  const info = lastInfo(ctx);
  assert.equal(info.face, false);
  assert.equal(info.reason, 'no_face');
  assert.equal(info.gaze, null);
});

test('a calibrated frame with open eyes produces the same gaze point as the cursor', () => {
  const ctx = setupEngine();
  const cursor = [];
  ctx.gaze.onGazeUpdate = (x, y) => cursor.push({ x, y });
  feedFrames(ctx, 200, EYES_OPEN);
  const info = lastInfo(ctx);
  assert.equal(info.face, true);
  assert.equal(info.reason, 'ok');
  assert.deepEqual(info.gaze, cursor[cursor.length - 1]);
  assert.ok(info.confidence > 0.2);
  assert.deepEqual(info.pose, { yaw: 0, pitch: 0, roll: 0 });
});

test('each eye is reported with its landmarks, EAR and open/used state, named by the patient\'s side', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 100, { openL: 0.3, openR: 0.25 });
  const [a, b] = lastInfo(ctx).eyes;
  const lm = faceLandmarks({ openL: 0.3, openR: 0.25 });
  // MediaPipe's "right eye" (33/133/159/145, iris 468) is the patient's right eye.
  assert.equal(a.side, 'right');
  assert.deepEqual(a.iris, { x: lm[468].x, y: lm[468].y });
  assert.deepEqual(a.corners, [{ x: lm[33].x, y: lm[33].y }, { x: lm[133].x, y: lm[133].y }]);
  assert.deepEqual(a.lids, [{ x: lm[159].x, y: lm[159].y }, { x: lm[145].x, y: lm[145].y }]);
  assert.ok(Math.abs(a.ear - 0.3) < 1e-4);
  assert.equal(b.side, 'left');
  assert.deepEqual(b.iris, { x: lm[473].x, y: lm[473].y });
  assert.ok(Math.abs(b.ear - 0.25) < 1e-4);
  assert.equal(a.open && b.open && a.used && b.used, true);
});

test('closed eyes are recorded as "eyes_closed", with each eye below the threshold', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 100, EYES_CLOSED);
  const info = lastInfo(ctx);
  assert.equal(info.reason, 'eyes_closed');
  assert.equal(info.gaze, null);
  assert.equal(info.earThreshold, 0.18);
  assert.deepEqual(info.eyes.map((e) => e.open), [false, false]);
});

test('before calibration the frame gives a cursor point, recorded as "uncalibrated"', () => {
  const ctx = setupEngine({ calibrated: false });
  feedFrames(ctx, 100, EYES_OPEN);
  const info = lastInfo(ctx);
  assert.equal(info.reason, 'uncalibrated');
  assert.ok(info.gaze && Number.isFinite(info.gaze.x));
});

test('during calibration frames are recorded as "calibrating", with no gaze point', () => {
  const ctx = setupEngine();
  ctx.gaze.startCalibration(5);
  feedFrames(ctx, 100, EYES_OPEN);
  const info = lastInfo(ctx);
  assert.equal(info.reason, 'calibrating');
  assert.equal(info.gaze, null);
});

test('a strongly turned head with the iris at the eye corner is recorded as "low_confidence"', () => {
  const ctx = setupEngine();
  for (let i = 0; i < 5; i++) {
    ctx.env.clock.advance(33);
    ctx.gaze._onFrame({ faceLandmarks: [faceLandmarks({ irisX: 0.05 })], facialTransformationMatrixes: [yawMatrix(70)] });
  }
  const info = lastInfo(ctx);
  assert.equal(info.reason, 'low_confidence');
  assert.ok(info.confidence < 0.2);
  assert.ok(Math.abs(info.pose.yaw - 70) < 1e-6);
});

test('"used" tells truthfully which eye the engine reads for "Left Eye Only", with and without "Swap"', () => {
  // The engine's "left" is MediaPipe's right-eye landmarks unless Swap is on.
  const plain = setupEngine({ settings: { activeEye: 'left' } });
  feedFrames(plain, 100, EYES_OPEN);
  assert.deepEqual(lastInfo(plain).eyes.map((e) => [e.side, e.used]), [['right', true], ['left', false]]);
  const swapped = setupEngine({ settings: { activeEye: 'left', swapEyes: true } });
  feedFrames(swapped, 100, EYES_OPEN);
  assert.deepEqual(lastInfo(swapped).eyes.map((e) => [e.side, e.used]), [['right', false], ['left', true]]);
});

test('onFrameInfo is called once per camera frame', () => {
  const ctx = setupEngine();
  let calls = 0;
  ctx.gaze.onFrameInfo = () => calls++;
  feedFrames(ctx, 330, EYES_OPEN);          // 10 frames
  ctx.gaze._onFrame({ faceLandmarks: [] }); // 1 without a face
  assert.equal(calls, 11);
});

test('the raw iris-in-eye ratio is recorded (what the uncalibrated cursor and the direction inset use)', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 100, { irisX: 0.7, irisY: 0.4 });
  const raw = lastInfo(ctx).raw;
  assert.ok(Math.abs(raw.x - 0.7) < 1e-4 && Math.abs(raw.y - 0.4) < 1e-4);
  feedFrames(ctx, 100, EYES_CLOSED);
  assert.equal(lastInfo(ctx).raw, null, 'no ratio without a usable eye');
});
