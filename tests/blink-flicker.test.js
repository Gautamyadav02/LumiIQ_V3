'use strict';
// A real webcam's eye opening is noisy: while the lids are shut, a single frame can measure just
// above the threshold. Each such frame used to end the closure, so one deliberate blink was cut into
// several short "blinks": it did not select, and two attempts raised the full-screen rapid-blinking
// alarm (6 in 3 s). It also restarted the 3-second eyes-closed alarm. Eyes now count as reopened only
// after they have stayed open for BLINK_REOPEN_MS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');

const look = (ctx, ms) => feedFrames(ctx, ms, EYES_OPEN);
const closeEyes = (ctx, ms) => feedFrames(ctx, ms, EYES_CLOSED);
const count = (alerts, type) => alerts.filter((a) => a.type === type).length;

/** One closure of about `ms`, with a single noisy "open" frame every `every` ms. */
function noisyClosure(ctx, ms, every = 200) {
  for (let done = 0; done < ms; done += every + 33) { closeEyes(ctx, every); look(ctx, 33); }
  closeEyes(ctx, 33);
}

test('a deliberate blink with a noisy frame in the middle still selects the key', () => {
  const ctx = setupEngine();
  look(ctx, 400);
  noisyClosure(ctx, 700);
  look(ctx, 300);
  assert.equal(ctx.fired.length, 1);
  assert.equal(ctx.fired[0].el, ctx.key);
});

test('noisy deliberate blinks do not raise the rapid-blinking alarm', () => {
  const ctx = setupEngine();
  for (let i = 0; i < 3; i++) { look(ctx, 400); noisyClosure(ctx, 700); }
  look(ctx, 300);
  assert.equal(count(ctx.alerts, 'RAPID_BLINKS'), 0);
  assert.equal(ctx.fired.length, 3, 'each attempt is one selection');
});

test('noise does not restart the eyes-closed alarm: closed 4 s with noisy frames raises it', () => {
  const ctx = setupEngine();
  noisyClosure(ctx, 4000, 500);
  assert.equal(count(ctx.alerts, 'PROLONGED_CLOSURE'), 1);
});

test('real rapid blinking (eyes open ~350 ms between blinks) still raises the alarm', () => {
  const ctx = setupEngine({ settings: { selectionMode: 'dwell' } });
  for (let i = 0; i < 8; i++) { closeEyes(ctx, 150); look(ctx, 350); }
  assert.equal(count(ctx.alerts, 'RAPID_BLINKS'), 1);
});

test('a blink is measured until the eyes first reopened, not until the reopening was confirmed', () => {
  // 450 ms shut is shorter than the 500 ms needed to select; the confirmation wait must not push it over.
  const ctx = setupEngine();
  look(ctx, 400); closeEyes(ctx, 450); look(ctx, 300);
  assert.equal(ctx.fired.length, 0);
});
