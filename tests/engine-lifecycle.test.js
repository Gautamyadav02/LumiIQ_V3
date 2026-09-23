'use strict';
// Engine start-up robustness: AUDIT L5 (every camera error reported as
// "permission denied"; GPU-only face tracking), L11 (double clicks loaded
// the engine twice / started two camera loops), L3 (dead settings sliders).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/browser-env');
const { setupEngine } = require('./helpers/engine');

function namedError(name) { const e = new Error(name); e.name = name; return e; }

test('L5: camera errors say what actually went wrong', () => {
  const { gaze } = setupEngine();
  assert.match(gaze._cameraErrorMessage(namedError('NotAllowedError')), /permission/i);
  assert.match(gaze._cameraErrorMessage(namedError('NotFoundError')), /no suitable camera/i);
  assert.match(gaze._cameraErrorMessage(namedError('NotReadableError')), /in use/i);
  assert.match(gaze._cameraErrorMessage(namedError('WeirdError')), /WeirdError/);
});

test('L5: a missing camera is reported as such, not as "permission denied"', async () => {
  const ctx = setupEngine();
  const statuses = [];
  ctx.gaze.onStatusUpdate = (msg) => statuses.push(msg);
  ctx.gaze.isInitialized = true;
  ctx.env.window.navigator.mediaDevices.getUserMedia = () => Promise.reject(namedError('NotFoundError'));
  assert.equal(await ctx.gaze.startCamera(), false);
  assert.match(statuses.at(-1), /no suitable camera/i);
});

test('L5: face tracking falls back to the CPU when the GPU is unavailable', async () => {
  const { gaze } = setupEngine();
  const tried = [];
  const FaceLandmarker = {
    async createFromOptions(vision, options) {
      tried.push(options.baseOptions.delegate);
      if (options.baseOptions.delegate === 'GPU') throw new Error('WebGL unavailable');
      return { delegate: options.baseOptions.delegate };
    },
  };
  const landmarker = await gaze._createLandmarker(FaceLandmarker, {});
  assert.deepEqual([...tried], ['GPU', 'CPU']);
  assert.equal(landmarker.delegate, 'CPU');
});

test('L11: clicking "start" twice loads the face-tracking engine once', async () => {
  const { gaze } = setupEngine();
  let imports = 0;
  gaze._importVision = async () => {
    imports += 1;
    return {
      FilesetResolver: { forVisionTasks: async () => ({}) },
      FaceLandmarker: { createFromOptions: async () => ({}) },
    };
  };
  const [a, b] = await Promise.all([gaze.init({}), gaze.init({})]);
  assert.equal(imports, 1);
  assert.equal(a && b, true);
});

test('L11: starting the camera twice opens it once', async () => {
  const ctx = setupEngine();
  const gaze = ctx.gaze;
  gaze.isInitialized = true;
  let opened = 0;
  const track = Object.assign(new EventTarget(), { getCapabilities: () => ({}), stop() {} });
  ctx.env.window.navigator.mediaDevices.getUserMedia = async () => {
    opened += 1;
    return { getVideoTracks: () => [track], getTracks: () => [track] };
  };
  const video = ctx.env.element({ tag: 'video' });
  gaze.videoElement = video;
  const first = gaze.startCamera();
  const second = gaze.startCamera();
  await new Promise((r) => setImmediate(r));
  video.dispatchEvent(new Event('loadeddata'));
  assert.deepEqual([await first, await second], [true, false]);
  assert.equal(opened, 1);
});

test('L3: the dead "Sensitivity X/Y" controls are gone', () => {
  for (const file of ['index.html', 'app.js', 'database.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /gazeSensitivity/, file);
  }
});
