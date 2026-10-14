'use strict';
// Blink to select ("blink to write"), added at the user's request after the audit:
// look at a key, then close the eyes deliberately (default at least 0.5 s) to select it.
// Normal blinks (~0.1-0.4 s) do not select; closures of 3 s or more raise the alarm.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');

const look = (ctx, ms) => feedFrames(ctx, ms, EYES_OPEN);
const closeEyes = (ctx, ms) => feedFrames(ctx, ms, EYES_CLOSED);
// The eyes must stay open for the engine's BLINK_REOPEN_MS (100 ms) before a closure counts as over.
const REOPEN = 150;

test('a deliberate blink while looking at a key selects it', () => {
  const ctx = setupEngine();                  // default mode: dwell or blink
  look(ctx, 400);                             // gaze settles; far too short for a dwell click
  assert.equal(ctx.fired.length, 0);
  closeEyes(ctx, 700);
  look(ctx, REOPEN);                              // eyes reopen
  assert.equal(ctx.fired.length, 1);
  assert.equal(ctx.fired[0].el, ctx.key);
});

test('a normal short blink does not select', () => {
  const ctx = setupEngine();
  look(ctx, 400); closeEyes(ctx, 200); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0);
});

test('a long eye closure (2 s) is not a selection', () => {
  const ctx = setupEngine();
  look(ctx, 400); closeEyes(ctx, 2000); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0);
});

test('blinking twice types the key twice (double letters)', () => {
  const ctx = setupEngine();
  look(ctx, 400); closeEyes(ctx, 700); look(ctx, 300); closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 2);
});

test('after a blink selection, continuing to look does not also dwell-click the key', () => {
  const ctx = setupEngine();
  look(ctx, 400); closeEyes(ctx, 700); look(ctx, 3000);
  assert.equal(ctx.fired.length, 1);
});

test('a blink only selects a key the gaze had settled on, not one it was passing', () => {
  const ctx = setupEngine();
  look(ctx, 100); closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0);
});

test('the cursor jump while the eyelids close does not lose the key', () => {
  const ctx = setupEngine();
  look(ctx, 400);
  const onKey = ctx.env.hit;
  ctx.env.hit = () => null;                   // lids closing drag the estimate off the key
  look(ctx, 66);
  ctx.env.hit = onKey;
  closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 1);
});

test('"Dwell only": a deliberate blink does nothing', () => {
  const ctx = setupEngine({ settings: { selectionMode: 'dwell' } });
  look(ctx, 400); closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0);
});

test('"Blink only": a steady gaze never clicks (the ring shows it is armed); a blink does', () => {
  const ctx = setupEngine({ settings: { selectionMode: 'blink' } });
  look(ctx, 5000);
  assert.equal(ctx.fired.length, 0);
  assert.equal(ctx.progress.at(-1).p, 1, 'ring full: blink to select');
  closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 1);
});

test('the required eyes-closed time follows the setting', () => {
  const ctx = setupEngine({ settings: { blinkSelectMs: 900 } });
  look(ctx, 400); closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0, '700 ms is shorter than the 900 ms setting');
  look(ctx, 400); closeEyes(ctx, 1000); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 1);
});

test('no blink selection before a calibration is accepted', () => {
  const ctx = setupEngine({ calibrated: false });
  look(ctx, 400); closeEyes(ctx, 700); look(ctx, REOPEN);
  assert.equal(ctx.fired.length, 0);
});

test('deliberate blinks do not count towards the rapid-blinking alarm', () => {
  const rapidBlinkAlarms = (selectionMode) => {
    const ctx = setupEngine({ settings: { selectionMode, blinkSelectMs: 300 } });
    for (let i = 0; i < 6; i++) { feedFrames(ctx, 350, EYES_CLOSED, 50); feedFrames(ctx, 150, EYES_OPEN, 50); }
    return ctx.alerts.filter((a) => a.type === 'RAPID_BLINKS').length;
  };
  assert.equal(rapidBlinkAlarms('dwell'), 1, 'blink-select off: these are rapid blinks');
  assert.equal(rapidBlinkAlarms('both'), 0, 'blink-select on (300 ms): these are deliberate blinks');
});
