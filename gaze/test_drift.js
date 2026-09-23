'use strict';
// Unit tests for DriftDetector. (This file used to print results without
// asserting anything, so it "passed" even when the result was wrong.)
// Run: node --test gaze/test_drift.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { DriftDetector } = require('./drift-detector.js');

const CENTRE = { x: 100, y: 100 };
const SIZE = { width: 100, height: 100 };
const ON_CENTRE = { x: 100, y: 100 };      // normalised error 0
const FAR_OFF = { x: 170, y: 100 };        // 70 px off a 100 px target: normalised error 0.7

function feed(detector, point, n) {
  let flagged = false;
  for (let i = 0; i < n; i++) flagged = detector.onDwellActivate(point, CENTRE, SIZE);
  return flagged;
}

test('accurate dwells never ask for recalibration', () => {
  assert.equal(feed(new DriftDetector(), ON_CENTRE, 20), false);
});

test('does not judge before 10 dwells', () => {
  assert.equal(feed(new DriftDetector(), FAR_OFF, 9), false);
});

test('sustained large errors from a fresh start ask for recalibration', () => {
  assert.equal(feed(new DriftDetector(), FAR_OFF, 15), true);
});

test('drift that follows a run of accurate dwells is flagged within 10 dwells', {
  todo: 'AUDIT M10: needs 18 consecutive misses here; threshold to be redesigned with Phase 1 data',
}, () => {
  const d = new DriftDetector();
  feed(d, ON_CENTRE, 20);
  assert.equal(feed(d, FAR_OFF, 10), true);
});
