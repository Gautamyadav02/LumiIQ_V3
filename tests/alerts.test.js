'use strict';
// Alarm regressions: AUDIT H2 (false "webhook sent"), M7 (duplicate alert rows),
// H3 (monitoring stopped silently), M11 (closure alarm repeating every 15 s),
// L7 (no safety detection during calibration).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv, ROOT } = require('./helpers/browser-env');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');

const count = (alerts, type) => alerts.filter((a) => a.type === type).length;
function noFace(ctx, ms, step = 100) {
  for (let e = 0; e < ms; e += step) { ctx.env.clock.advance(step); ctx.gaze._onFrame({ faceLandmarks: [] }); }
}
function tracking(ctx) {
  ctx.gaze.isTracking = true;
  ctx.gaze._lastFaceSeen = ctx.env.clock.now;
}

// ── H2 ──────────────────────────────────────────────────────────────
test('H2: the alarm screen does not claim that anyone was notified remotely', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /webhook/i);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), /Would POST/);
});

// ── M7 ──────────────────────────────────────────────────────────────
test('M7: one emergency is logged exactly once', () => {
  const ctx = setupEngine();
  const raised = [];
  ctx.gaze.onEmergencyAlert = (type) => raised.push(type);
  ctx.gaze._triggerEmergency('NURSE_CALL_BUTTON', 'Patient pressed Nurse Call');
  assert.equal(ctx.alerts.length, 1);
  assert.deepEqual(raised, ['NURSE_CALL_BUTTON']);
});

test('M7: the app and the keyboard no longer log alerts themselves', () => {
  const env = createEnv();
  const logged = [];
  env.window.LumiStore = { addAlertLog: (t) => logged.push(t), getSettings: () => ({}),
    getTypedLogs: () => [], getSymptomLogs: () => [], getAlertLogs: () => [] };
  env.load('keyboard.js', 'app.js');
  const events = [];
  env.window.addEventListener('eye_emergency_alert', (e) => events.push(e.detail.type));
  env.get('LumiKeyboard')._nurseCall();
  env.get('EyeApp')._onEmergency('NURSE_CALL_BUTTON', 'x');
  assert.deepEqual(logged, [], 'logging happens only in LumiGaze._triggerEmergency');
  assert.deepEqual(events, ['NURSE_CALL_BUTTON'], 'Nurse Call is raised via the engine');
});

// ── M11 ─────────────────────────────────────────────────────────────
test('M11: eyes staying closed raise one alarm, not one every 15 s', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 40000, EYES_CLOSED, 100);
  assert.equal(count(ctx.alerts, 'PROLONGED_CLOSURE'), 1);
});

test('M11: a new closure after the eyes reopen raises a new alarm', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 4000, EYES_CLOSED, 100);
  feedFrames(ctx, 1000, EYES_OPEN, 100);
  feedFrames(ctx, 4000, EYES_CLOSED, 100);
  assert.equal(count(ctx.alerts, 'PROLONGED_CLOSURE'), 2);
});

test('rapid blinking raises one alarm per 15 s', () => {
  const ctx = setupEngine();
  for (let i = 0; i < 12; i++) {            // 12 blinks of 150 ms within ~6 s
    feedFrames(ctx, 150, EYES_CLOSED, 50);
    feedFrames(ctx, 350, EYES_OPEN, 50);
  }
  assert.equal(count(ctx.alerts, 'RAPID_BLINKS'), 1);
});

// ── H3 ──────────────────────────────────────────────────────────────
test('H3: no face for the configured time raises one FACE_NOT_DETECTED alarm', () => {
  const ctx = setupEngine({ settings: { faceLostAlarmSec: 10 } });
  tracking(ctx);
  noFace(ctx, 9000);
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 0, 'not before 10 s');
  noFace(ctx, 20000);
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 1, 'once per episode');
  feedFrames(ctx, 500, EYES_OPEN);           // face back
  noFace(ctx, 11000);
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 2, 'a new episode alarms again');
});

test('H3: the face-lost delay follows the setting', () => {
  const ctx = setupEngine({ settings: { faceLostAlarmSec: 5 } });
  tracking(ctx);
  noFace(ctx, 5500);
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 1);
});

test('H3: no face-lost alarm while the camera is off', () => {
  const ctx = setupEngine();
  noFace(ctx, 30000);
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 0);
});

test('H3: a camera that disconnects raises CAMERA_LOST and stops tracking', () => {
  const ctx = setupEngine();
  tracking(ctx);
  ctx.gaze._onCameraLost();
  ctx.gaze._onCameraLost();                  // duplicate 'ended' events
  assert.equal(count(ctx.alerts, 'CAMERA_LOST'), 1);
  assert.equal(ctx.gaze.isTracking, false);
});

test('H3: hiding the app while monitoring is logged, and reported on return', () => {
  const ctx = setupEngine();
  const notices = [];
  ctx.gaze.onNotice = (msg) => notices.push(msg);
  tracking(ctx);
  ctx.env.document.hidden = true;
  ctx.env.document.dispatchEvent(new Event('visibilitychange'));
  ctx.env.clock.advance(12000);
  ctx.env.document.hidden = false;
  ctx.env.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(count(ctx.alerts, 'MONITORING_PAUSED'), 1);
  assert.equal(count(ctx.alerts, 'MONITORING_RESUMED'), 1);
  assert.match(notices.at(-1), /paused for 12s/);
  noFace(ctx, 1000);                         // the hidden time is not counted as "no face"
  assert.equal(count(ctx.alerts, 'FACE_NOT_DETECTED'), 0);
});

test('H3: stopping the camera shows a persistent "monitoring off" notice; starting clears it', async () => {
  const ctx = setupEngine();
  const notices = [];
  ctx.gaze.onNotice = (msg) => notices.push(msg);
  tracking(ctx);
  ctx.gaze.stopCamera();
  assert.match(notices.at(-1), /monitoring is off/i);
});

// ── L7 ──────────────────────────────────────────────────────────────
test('L7: prolonged eye closure is still detected during calibration', () => {
  const ctx = setupEngine();
  ctx.gaze.startCalibration(9);
  feedFrames(ctx, 4000, EYES_CLOSED, 100);
  assert.equal(count(ctx.alerts, 'PROLONGED_CLOSURE'), 1);
});
