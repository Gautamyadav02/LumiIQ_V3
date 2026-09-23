'use strict';
// Dwell controller regressions: AUDIT H1 (instant activation after a tracking
// gap), L1 (non-monotonic progress) and M3 (same target re-fires while looked at).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('./helpers/browser-env');
const { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED } = require('./helpers/engine');
const { DwellController } = require(path.join(ROOT, 'gaze/dwell-controller.js'));

const KEY_RECT = { left: 100, top: 100, right: 230, bottom: 250 };
const onKey = (x, y) => x >= KEY_RECT.left && x <= KEY_RECT.right && y >= KEY_RECT.top && y <= KEY_RECT.bottom;

function controller(extra = {}) {
  const log = { fires: [], progress: [] };
  let now = 0;
  const d = new DwellController(Object.assign({
    dwellTime: 1200, adaptive: false, hitTest: (x, y) => (onKey(x, y) ? 'KEY' : null),
    onActivate: (el) => log.fires.push({ el, t: now }),
    onProgress: (el, p) => log.progress.push(p),
  }, extra));
  const step = (x, y, ms = 33) => { now += ms; d.update(x, y, now); };
  const hold = (x, y, ms, frame = 33) => { for (let e = 0; e < ms; e += frame) step(x, y, frame); };
  const skip = (ms) => { now += ms; d.noGaze(now); };
  return { d, log, step, hold, skip, get now() { return now; } };
}

test('H1: a long tracking gap mid-dwell cancels the dwell instead of completing it', () => {
  const c = controller();
  c.hold(160, 170, 500);                      // focus + part of the dwell
  assert.ok(c.log.progress.at(-1) > 0.2);
  c.skip(2000);                               // eyes closed / face lost for 2 s
  c.step(160, 170);                           // first frame back, same key
  assert.equal(c.log.fires.length, 0, 'must not fire on the first frame after a gap');
  c.hold(160, 170, 1500);                     // a full, fresh focus + dwell
  assert.equal(c.log.fires.length, 1);
});

test('H1: the dwell ring is cleared once a gap exceeds the tolerance, not before', () => {
  const c = controller();
  c.hold(160, 170, 500);
  const before = c.log.progress.length;
  c.skip(200);                                // shorter than maxGapMs (300)
  assert.equal(c.log.progress.length, before, 'short gap: nothing reported yet');
  c.skip(200);                                // now 400 ms since the last sample
  assert.equal(c.log.progress.at(-1), 0, 'ring cleared');
  assert.equal(c.d.getState(), 'idle');
});

test('H1: a normal blink is tolerated, and adds at most maxStepMs of dwell time', () => {
  const c = controller();
  c.hold(160, 170, 450);                      // focus (150) + ~300 ms of dwell
  const before = c.log.progress.at(-1);
  c.step(160, 170, 250);                      // one frame after a 250 ms blink
  const after = c.log.progress.at(-1);
  assert.equal(c.d.getState(), 'dwelling', 'still dwelling after a short blink');
  assert.ok(after - before <= 100 / 1200 + 1e-9, `progress grew by ${after - before}`);
});

test('L1: progress never goes backwards when the dwell time changes mid-dwell', () => {
  const c = controller();
  c.hold(160, 170, 600);
  c.d.setDwellTime(2400);                     // confidence dipped: the engine doubles the dwell time
  c.hold(160, 170, 100);
  c.d.setDwellTime(1200);                     // confidence recovered
  c.hold(160, 170, 100);
  const p = c.log.progress.filter((v) => v > 0);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1], `progress fell from ${p[i - 1]} to ${p[i]}`);
});

test('M3: gaze resting on one key activates it once, not repeatedly', () => {
  const c = controller();
  c.hold(160, 170, 10000);
  assert.equal(c.log.fires.length, 1);
});

test('M3: looking away and back re-arms the key', () => {
  const c = controller();
  c.hold(160, 170, 2000);
  c.hold(500, 500, 200);                      // off the key
  c.hold(160, 170, 2000);
  assert.equal(c.log.fires.length, 2);
});

test('M3: a target re-rendered in the same place stays blocked until the gaze leaves it', () => {
  let current = { id: 1 };                    // the UI replaces the element after each activation
  const c = controller({
    hitTest: (x, y) => (onKey(x, y) ? current : null),
    getRect: () => KEY_RECT,
    onActivate: () => { c.fires += 1; current = { id: current.id + 1 }; },
  });
  c.fires = 0;
  c.hold(160, 170, 6000);
  assert.equal(c.fires, 1);
  c.hold(500, 500, 200);
  c.hold(160, 170, 2000);
  assert.equal(c.fires, 2);
});

test('H1 (engine): closing the eyes mid-dwell cancels it; reopening does not click', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 500, EYES_OPEN);
  assert.ok(ctx.progress.at(-1).p > 0, 'dwell started');
  feedFrames(ctx, 2000, EYES_CLOSED);
  assert.equal(ctx.progress.at(-1).p, 0, 'ring cleared while the eyes were closed');
  feedFrames(ctx, 300, EYES_OPEN);
  assert.equal(ctx.fired.length, 0, 'no click on reopening');
  feedFrames(ctx, 2000, EYES_OPEN);
  assert.equal(ctx.fired.length, 1, 'a fresh dwell still works');
});

test('H1 (engine): losing the face mid-dwell cancels it', () => {
  const ctx = setupEngine();
  feedFrames(ctx, 500, EYES_OPEN);
  for (let i = 0; i < 30; i++) { ctx.env.clock.advance(33); ctx.gaze._onFrame({ faceLandmarks: [] }); }
  assert.equal(ctx.progress.at(-1).p, 0);
  feedFrames(ctx, 100, EYES_OPEN);
  assert.equal(ctx.fired.length, 0);
});

// ── Options added for blink-to-select (user decision after the audit) ──
test('autoActivate=false: the ring fills to show the target is armed, but dwell never clicks', () => {
  const c = controller({ autoActivate: false });
  c.hold(160, 170, 5000);
  assert.equal(c.log.fires.length, 0);
  assert.equal(c.log.progress.at(-1), 1, 'ring stays full while the gaze stays');
});

test('repeatWhileLooking=true: keeping the gaze on a key repeats it (optional behaviour)', () => {
  const c = controller({ repeatWhileLooking: true });
  c.hold(160, 170, 10000);
  assert.ok(c.log.fires.length >= 3, `fires=${c.log.fires.length}`);
});

test('markActivated: after a blink selection, dwell does not click the same key again until the gaze leaves', () => {
  const c = controller();
  c.hold(160, 170, 300);
  c.d.markActivated('KEY', c.now);
  c.hold(160, 170, 5000);
  assert.equal(c.log.fires.length, 0);
  c.hold(500, 500, 200);
  c.hold(160, 170, 2000);
  assert.equal(c.log.fires.length, 1);
});
