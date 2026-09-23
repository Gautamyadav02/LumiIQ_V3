'use strict';
// Sleep mode (added at the user's request, resolving the open decision on AUDIT M11):
// the caregiver switches it on when the patient goes to sleep. Only the eyes-closed
// alarm is paused; all other monitoring stays on, and once the patient has fallen asleep
// (eyes closed 30 s), activity — eyes open for a while, or a selection — is reported to
// the caregiver once per waking.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');

const count = (ctx, type) => ctx.alerts.filter((a) => a.type === type).length;
const HOUR = 3600 * 1000;

/** The patient looks at empty space: no target under the gaze, so nothing is selected. */
function lookAtNothing(ctx) { ctx.env.hit = () => null; return ctx; }

function asleep(overrides = {}) {
  const ctx = setupEngine(overrides);
  ctx.wall = Date.UTC(2026, 8, 23, 22, 0, 0);            // 23:00 — fake wall clock
  ctx.gaze._wallNow = () => ctx.wall;
  ctx.updates = [];
  ctx.gaze.onSleepActivity = (what) => ctx.updates.push(what);
  ctx.gaze.isTracking = true;
  ctx.gaze._lastFaceSeen = ctx.env.clock.now;
  ctx.gaze.setSleepMode(true);
  return ctx;
}

test('switching sleep mode on and off is logged and remembered', () => {
  const ctx = asleep();
  assert.equal(ctx.gaze.isSleepMode(), true);
  assert.ok(ctx.store.settings.sleepModeUntil > ctx.wall, 'saved, so it survives a reload');
  ctx.gaze.setSleepMode(false);
  assert.equal(ctx.gaze.isSleepMode(), false);
  assert.equal(ctx.store.settings.sleepModeUntil, 0);
  assert.deepEqual(ctx.alerts.map((a) => a.type), ['SLEEP_MODE_ON', 'SLEEP_MODE_OFF']);
});

test('in sleep mode, eyes closed for a long time do not sound the alarm', () => {
  const ctx = asleep();
  feedFrames(ctx, 40000, EYES_CLOSED, 100);
  assert.equal(count(ctx, 'PROLONGED_CLOSURE'), 0);
});

test('without sleep mode, the eyes-closed alarm still sounds', () => {
  const ctx = asleep();
  ctx.gaze.setSleepMode(false);
  feedFrames(ctx, 4000, EYES_CLOSED, 100);
  assert.equal(count(ctx, 'PROLONGED_CLOSURE'), 1);
});

test('in sleep mode, the other alarms stay on (no face, rapid blinking, camera lost)', () => {
  const ctx = asleep();
  for (let t = 0; t < 11000; t += 100) { ctx.env.clock.advance(100); ctx.gaze._onFrame({ faceLandmarks: [] }); }
  assert.equal(count(ctx, 'FACE_NOT_DETECTED'), 1);
  for (let i = 0; i < 7; i++) { feedFrames(ctx, 150, EYES_CLOSED, 50); feedFrames(ctx, 300, EYES_OPEN, 50); }
  assert.equal(count(ctx, 'RAPID_BLINKS'), 1);
  ctx.gaze._onCameraLost();
  assert.equal(count(ctx, 'CAMERA_LOST'), 1);
});

test('the patient waking (eyes open 5 s) is reported to the caregiver once', () => {
  const ctx = lookAtNothing(asleep());
  feedFrames(ctx, 60000, EYES_CLOSED, 100);
  feedFrames(ctx, 4000, EYES_OPEN, 100);
  assert.equal(ctx.updates.length, 0, 'not before 5 s');
  feedFrames(ctx, 20000, EYES_OPEN, 100);
  assert.equal(ctx.updates.length, 1, 'once, not repeatedly');
  assert.match(ctx.updates[0], /eyes open/);
  assert.equal(count(ctx, 'SLEEP_ACTIVITY'), 1, 'recorded in the safety log');
});

test('a brief eye opening while asleep is not reported', () => {
  const ctx = lookAtNothing(asleep());
  feedFrames(ctx, 30000, EYES_CLOSED, 100);
  feedFrames(ctx, 2000, EYES_OPEN, 100);
  feedFrames(ctx, 30000, EYES_CLOSED, 100);
  assert.equal(ctx.updates.length, 0);
});

test('turning sleep mode on while the patient is still awake reports nothing', () => {
  const ctx = asleep();                         // even though the awake patient dwell-clicks the key
  feedFrames(ctx, 20000, EYES_OPEN, 100);       // still awake at bedtime
  assert.equal(ctx.updates.length, 0);
});

test('falling back asleep re-arms the report for the next waking', () => {
  const ctx = lookAtNothing(asleep());
  feedFrames(ctx, 35000, EYES_CLOSED, 100);     // falls asleep (30 s)
  feedFrames(ctx, 6000, EYES_OPEN, 100);        // wakes
  feedFrames(ctx, 35000, EYES_CLOSED, 100);     // back asleep
  feedFrames(ctx, 6000, EYES_OPEN, 100);        // wakes again
  assert.equal(ctx.updates.length, 2);
});

test('the report delay follows the caregiver setting', () => {
  const ctx = lookAtNothing(asleep({ settings: { sleepWakeSec: 20 } }));
  feedFrames(ctx, 35000, EYES_CLOSED, 100);
  feedFrames(ctx, 10000, EYES_OPEN, 100);
  assert.equal(ctx.updates.length, 0);
  feedFrames(ctx, 11000, EYES_OPEN, 100);
  assert.equal(ctx.updates.length, 1);
});

test('a selection made after waking is reported as activity', () => {
  const ctx = asleep();
  feedFrames(ctx, 35000, EYES_CLOSED, 100);     // asleep
  feedFrames(ctx, 3000, EYES_OPEN);             // wakes and dwell-clicks the key within 3 s
  assert.equal(ctx.fired.length, 1);
  assert.equal(ctx.updates.length, 1);
  assert.match(ctx.updates[0], /selected/);
});

test('sleep mode ends by itself after 12 hours, and says so', () => {
  const ctx = asleep();
  ctx.wall += 12 * HOUR + 1000;
  feedFrames(ctx, 200, EYES_CLOSED, 100);
  assert.equal(ctx.gaze.isSleepMode(), false);
  assert.equal(count(ctx, 'SLEEP_MODE_OFF'), 1);
  feedFrames(ctx, 4000, EYES_CLOSED, 100);
  assert.equal(count(ctx, 'PROLONGED_CLOSURE'), 1, 'the eyes-closed alarm is back');
});

test('an out-of-range stored end time is not trusted (never more than 12 hours ahead)', () => {
  const ctx = asleep();
  ctx.store.settings.sleepModeUntil = ctx.wall + 1000 * HOUR;
  assert.equal(ctx.gaze.isSleepMode(), false);
});
