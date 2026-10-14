'use strict';
// Phase B: what the engine exposes for session recording. All of it is passive:
// nothing in the gaze pipeline reads these values back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');
const { faceLandmarks, FACING_CAMERA } = require('./helpers/landmarks');

const plain = (v) => JSON.parse(JSON.stringify(v));
const last = (ctx) => plain(ctx.gaze.lastFrameInfo);

test('each gaze frame carries its features, the raw prediction and the time given to the smoother', () => {
  const ctx = setupEngine();                       // stub model: always the screen centre (1440×900)
  feedFrames(ctx, 200, { irisX: 0.6, irisY: 0.45 });
  const info = last(ctx);
  assert.equal(info.features.length, 10);
  assert.ok(Math.abs(info.features[0] - 0.6) < 1e-4);
  assert.deepEqual(info.pred, { x: 720, y: 450 }, 'the model output in pixels, before smoothing');
  assert.equal(info.tGaze, ctx.env.clock.now);
  assert.ok(info.gaze, 'and the smoothed point');
});

test('frames without a gaze point have no prediction', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 100, EYES_CLOSED);
  assert.equal(last(ctx).pred, null);
  assert.equal(last(ctx).features, null);
});

test('landmarks and the head matrix are attached only while a recording asks for them', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 66, EYES_OPEN);
  assert.equal(ctx.gaze.captureRaw, false);
  assert.equal(ctx.gaze.lastFrameInfo.lm, undefined);
  ctx.gaze.captureRaw = true;
  feedFrames(ctx, 66, { irisX: 0.3 });
  const info = last(ctx);
  const F = ctx.env.get('GazeFeatures');
  assert.deepEqual(info.lm, plain(F.pack(faceLandmarks({ irisX: 0.3 }))));
  assert.deepEqual(info.matrix, FACING_CAMERA.data);
});

test('calibration: sample frames are flagged, and clearing and committing a point are announced', () => {
  const ctx = setupEngine();
  const events = [];
  ctx.gaze.onCalibrationClear = () => events.push('clear');
  ctx.gaze.onCalibrationPoint = (p) => events.push(plain(p));
  const first = plain(ctx.gaze.startCalibration(5));
  feedFrames(ctx, 100, EYES_OPEN);
  assert.equal(last(ctx).calSample, true);
  feedFrames(ctx, 66, EYES_CLOSED);
  assert.equal(last(ctx).calSample, false, 'a closed-eye frame adds no sample');
  ctx.gaze.clearCalibrationSamples();
  assert.deepEqual(events, ['clear']);
  feedFrames(ctx, 200, EYES_OPEN);                 // 7 frames: too few
  assert.equal(ctx.gaze.captureCalibrationPoint().error, 'insufficient');
  assert.equal(events.length, 1, 'no point is announced when it must be repeated');
  feedFrames(ctx, 600, EYES_OPEN);                 // 19 more
  ctx.gaze.captureCalibrationPoint();
  const point = events[1];
  assert.equal(point.index, 0);
  assert.equal(point.total, 5);
  assert.deepEqual(point.target, { x: first.x, y: first.y });
  assert.equal(point.samples, 26, 'the frames in the buffer when the point was committed');
  assert.equal(point.accepted + point.rejected, 26);
});

test('a failing recording hook is logged and never disturbs calibration', () => {
  const ctx = setupEngine();
  ctx.gaze.onCalibrationPoint = () => { throw new Error('recorder bug'); };
  const logged = [];
  ctx.env.window.console = { error: (...a) => logged.push(a.join(' ')), warn() {}, log() {} };
  ctx.gaze.startCalibration(5);
  feedFrames(ctx, 700, EYES_OPEN);
  const res = ctx.gaze.captureCalibrationPoint();
  assert.equal(res.done, false);
  assert.equal(res.target.index, 1);
});

test('a selection says whether dwell or a blink made it', () => {
  const dwell = setupEngine({ settings: { selectionMode: 'both', blinkSelectMs: 500 } });
  assert.equal(dwell.gaze.lastSelectionBy, null);
  feedFrames(dwell, 2500, EYES_OPEN);                 // rests on the key until the ring fills
  assert.equal(dwell.fired.length, 1);
  assert.equal(dwell.gaze.lastSelectionBy, 'dwell');

  const blink = setupEngine({ settings: { selectionMode: 'blink', blinkSelectMs: 500 } });
  feedFrames(blink, 800, EYES_OPEN);                  // rest on the key…
  feedFrames(blink, 700, EYES_CLOSED);                // …close the eyes deliberately…
  feedFrames(blink, 100, EYES_OPEN);                  // …and open them
  assert.equal(blink.fired.length, 1);
  assert.equal(blink.gaze.lastSelectionBy, 'blink');
});
