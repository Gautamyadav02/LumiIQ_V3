'use strict';
// Phase B: feature extraction lives in gaze/gaze-features.js so that the live
// engine and the offline replay (eval/replay.js) run exactly the same code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv, GAZE_MODULES, ROOT } = require('./helpers/browser-env');
const { faceLandmarks, FACING_CAMERA } = require('./helpers/landmarks');

const SETTINGS = { earThreshold: 0.18, activeEye: 'both', swapEyes: false };
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the module loads under Node and builds the 10-number feature vector', () => {
  const F = require('../gaze/gaze-features.js');
  assert.equal(F.FEATURE_DIM, 10);
  const fx = F.extract(faceLandmarks({ irisX: 0.7, irisY: 0.4, openL: 0.3, openR: 0.26 }), FACING_CAMERA, SETTINGS);
  assert.equal(fx.features.length, 10);
  const [lx, ly, rx, ry, yaw, pitch, roll, ear] = fx.features;
  assert.ok(Math.abs(lx - 0.7) < 1e-4 && Math.abs(rx - 0.7) < 1e-4 && Math.abs(ly - 0.4) < 1e-4 && Math.abs(ry - 0.4) < 1e-4);
  assert.ok([yaw, pitch, roll].every((v) => Math.abs(v) < 1e-12), 'facing the camera: no head rotation');
  assert.ok(Math.abs(ear - 0.28) < 1e-4);
  assert.equal(fx.eyeMode, 'both');
});

test('the engine uses the module: same features, head pose and confidence, with the improvements switched on', () => {
  const env = createEnv();
  env.window.LumiStore = { getSettings: () => SETTINGS, addAlertLog() {}, getCalibration: () => null };
  env.load(...GAZE_MODULES, 'gaze-engine.js');
  const gaze = env.get('LumiGaze');
  const F = env.get('GazeFeatures');
  const yaw = { data: [0.94, 0, -0.342, 0, 0, 1, 0, 0, 0.342, 0, 0.94, 0, 0, 0, 0, 1] };
  // All Phase C improvements are on by default; no camera size yet means 16:9.
  const on = { ...F.improvementOptions(F.flags('all')).features, aspect: 16 / 9 };
  for (const eyes of [{}, { irisX: 0.3, irisY: 0.65 }, { openL: 0.05 }, { openL: 0.05, openR: 0.05 }]) {
    const lm = faceLandmarks(eyes);
    assert.deepEqual(plain(gaze._extractFeatures(lm, yaw, SETTINGS)), plain(F.extract(lm, yaw, SETTINGS, on)));
  }
  assert.deepEqual(plain(gaze._headPose(yaw)), plain(F.headPose(yaw)));
  const f = [0.05, 0.5, 0.5, 0.5, 40, 0, 0, 0.5, 0.1, 0.1];
  assert.equal(gaze._computeConfidence(f), F.confidence(f, on));
  // Switched off, exactly the Phase B module calls.
  gaze.setImprovements('none');
  const lm = faceLandmarks({ irisX: 0.3, irisY: 0.65 });
  assert.deepEqual(plain(gaze._extractFeatures(lm, yaw, SETTINGS)), plain(F.extract(lm, yaw, SETTINGS)));
  assert.equal(gaze._computeConfidence(f), F.confidence(f));
  assert.equal(gaze.FEATURE_DIM, F.FEATURE_DIM);
});

test('packed landmarks (what a session records) give the same features as the full mesh', () => {
  const F = require('../gaze/gaze-features.js');
  const lm = faceLandmarks({ irisX: 0.62, irisY: 0.45, openL: 0.27, openR: 0.31 });
  const packed = F.pack(lm);
  assert.equal(packed.length, F.RECORD_INDICES.length * 3);
  assert.ok(packed.every((v) => typeof v === 'number'));
  const sparse = F.unpack(packed);
  assert.deepEqual(F.extract(sparse, FACING_CAMERA, SETTINGS), F.extract(lm, FACING_CAMERA, SETTINGS));
});

test('dwell slows down when the average confidence is low', () => {
  const F = require('../gaze/gaze-features.js');
  assert.equal(F.dwellScale(0.9), 1);
  assert.equal(F.dwellScale(0.6), 1.3);
  assert.equal(F.dwellScale(0.3), 2);
  assert.ok(Math.abs(F.smoothConfidence(1, 0) - 0.9) < 1e-12);
});

test('index.html loads gaze-features.js before the engine', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.includes('gaze/gaze-features.js'));
  assert.ok(order.indexOf('gaze/gaze-features.js') < order.indexOf('gaze-engine.js'));
});
