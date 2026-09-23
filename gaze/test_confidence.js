'use strict';
// Unit tests for LumiGaze._computeConfidence — the REAL engine method.
// (This file used to re-implement the function locally and assert nothing.)
// Run: node --test gaze/test_confidence.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, GAZE_MODULES } = require('../tests/helpers/browser-env');

const LumiGaze = createEnv().load(...GAZE_MODULES, 'gaze-engine.js').get('LumiGaze');

// Feature vector: [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]
const clean = () => [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.25, 0.12, 0.10];
const withFeature = (i, v) => { const f = clean(); f[i] = v; return f; };
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('a clean frame scores 1.0', () => {
  assert.equal(LumiGaze._computeConfidence(clean()), 1);
});

test('an implausible eye opening (EAR outside 0.12..0.45) halves the score', () => {
  assert.ok(close(LumiGaze._computeConfidence(withFeature(7, 0.05)), 0.5));
  assert.ok(close(LumiGaze._computeConfidence(withFeature(7, 0.50)), 0.5));
});

test('an iris outside the eye outline multiplies the score by 0.6', () => {
  assert.ok(close(LumiGaze._computeConfidence(withFeature(0, 0.95)), 0.6));
});

test('large head turns are penalised, with a floor of 0.3', () => {
  assert.ok(close(LumiGaze._computeConfidence(withFeature(4, 30)), 1 - 5 / 45));
  assert.ok(close(LumiGaze._computeConfidence(withFeature(4, 100)), 0.3));
  assert.ok(close(LumiGaze._computeConfidence(withFeature(5, 30)), 1 - 10 / 40));
});
