'use strict';
// Phase A (diagnosis): diagnostics.js — mapping camera coordinates onto the
// displayed feed, the detection overlay, frame statistics and the eyes
// open/closed check. All figures stay in memory, on this screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

function load() {
  const env = createEnv();
  env.load('diagnostics.js');
  return { env, D: env.get('LumiDiagnostics') };
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A canvas 2D context that records what is drawn. */
function recordingContext() {
  const calls = [];
  const ctx = { calls };
  for (const fn of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'closePath', 'fill', 'stroke',
                    'moveTo', 'lineTo', 'fillRect', 'strokeRect']) {
    ctx[fn] = (...args) => calls.push([fn, ...args]);
  }
  ctx.arc = (x, y, r) => calls.push(['arc', x, y, r]);
  ctx.fillText = (text, x, y) => calls.push(['fillText', String(text), x, y]);
  return ctx;
}

function eye(side, cx, ear, { open = true, used = true } = {}) {
  return { side, iris: { x: cx, y: 0.45 }, corners: [{ x: cx - 0.03, y: 0.45 }, { x: cx + 0.03, y: 0.45 }],
           lids: [{ x: cx, y: 0.45 - ear * 0.03 }, { x: cx, y: 0.45 + ear * 0.03 }], ear, open, used };
}

function frame({ reason = 'ok', ear = 0.25, conf = 0.9, threshold = 0.18, face = reason !== 'no_face' } = {}) {
  const open = ear > threshold;
  return face
    ? { face: true, reason, confidence: conf, earThreshold: threshold, pose: { yaw: 2, pitch: -3, roll: 1 },
        eyes: [eye('right', 0.4, ear, { open }), eye('left', 0.6, ear, { open })],
        gaze: reason === 'ok' || reason === 'uncalibrated' ? { x: 100, y: 100 } : null }
    : { face: false, reason: 'no_face', confidence: 0, earThreshold: threshold, eyes: [], pose: null, gaze: null };
}

// ── Mapping camera coordinates onto the displayed feed ──────────────

test('feedMapping: a 16:9 camera in a 4:3 box (object-fit: cover) is cropped left and right', () => {
  const { D } = load();
  const map = D.feedMapping(1280, 720, 400, 300, false);
  assert.ok(near(map(0.5, 0.5).x, 200) && near(map(0.5, 0.5).y, 150), 'centre stays centre');
  // Scale 300/720; the frame is 533.3 px wide, so 1/8 of it is cut off on each side.
  assert.ok(near(map(0.125, 0).x, 0) && near(map(0.125, 0).y, 0), 'x = 0.125 is the left edge');
  assert.ok(near(map(0.875, 1).x, 400) && near(map(0.875, 1).y, 300), 'x = 0.875 is the right edge');
});

test('feedMapping: a mirrored feed flips x about the box centre, like CSS scaleX(-1)', () => {
  const { D } = load();
  const plain = D.feedMapping(1280, 720, 400, 300, false);
  const mirror = D.feedMapping(1280, 720, 400, 300, true);
  for (const [nx, ny] of [[0.3, 0.4], [0.7, 0.2], [0.125, 0.9]]) {
    assert.ok(near(mirror(nx, ny).x, 400 - plain(nx, ny).x));
    assert.ok(near(mirror(nx, ny).y, plain(nx, ny).y));
  }
});

test('feedMapping: a 4:3 camera in a 4:3 box is only scaled', () => {
  const { D } = load();
  const map = D.feedMapping(640, 480, 320, 240, false);
  assert.ok(near(map(0, 0).x, 0) && near(map(1, 1).x, 320) && near(map(1, 1).y, 240));
});

// ── Detection overlay ───────────────────────────────────────────────

test('overlay: each iris centre is drawn exactly where the mapping puts it', () => {
  const { D } = load();
  const map = D.feedMapping(1280, 720, 400, 300, true);
  const ctx = recordingContext();
  const info = frame();
  D.drawOverlay(ctx, info, map, { width: 400, height: 300 });
  const arcs = ctx.calls.filter((c) => c[0] === 'arc');
  for (const e of info.eyes) {
    const p = map(e.iris.x, e.iris.y);
    assert.ok(arcs.some((a) => near(a[1], p.x) && near(a[2], p.y)), `${e.side} iris drawn at its mapped position`);
  }
  // Only short EAR labels go on the video; a text panel would cover the eyes on a small feed.
  const labels = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.deepEqual(labels, ['R 0.25', 'L 0.25']);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillRect').length, 0, 'no text panel over the video');
});

test('readout: the frame described in words, for the text box under the video', () => {
  const { D } = load();
  const text = D.describeFrame(frame()).join('\n');
  assert.match(text, /EAR R 0\.25 open/);
  assert.match(text, /threshold 0\.18/);
  assert.match(text, /confidence 0\.90/);
  assert.match(text, /yaw 2°\s+pitch -3°\s+roll 1°/);
  assert.match(text, /gaze point: yes/);
  assert.match(D.describeFrame(frame({ reason: 'eyes_closed', ear: 0.1 })).join('\n'), /gaze point: no \(no usable eye/);
});

test('overlay: a frame without a face draws nothing, and the readout says so', () => {
  const { D } = load();
  const ctx = recordingContext();
  D.drawOverlay(ctx, frame({ reason: 'no_face' }), D.feedMapping(1280, 720, 400, 300, true), { width: 400, height: 300 });
  assert.equal(ctx.calls.filter((c) => c[0] === 'arc').length, 0);
  assert.match(D.describeFrame(frame({ reason: 'no_face' })).join('\n'), /no face/i);
});

test('direction inset: the dot sits left of centre when the eyes look to the screen\'s left', () => {
  const { D } = load();
  const ctx = recordingContext();
  const box = { width: 400, height: 300 };
  D.drawDirection(ctx, { x: 0.2, y: 0.5 }, box);
  const leftDot = ctx.calls.filter((c) => c[0] === 'arc').pop();
  const ctx2 = recordingContext();
  D.drawDirection(ctx2, { x: 0.8, y: 0.5 }, box);
  const rightDot = ctx2.calls.filter((c) => c[0] === 'arc').pop();
  assert.ok(leftDot[1] < rightDot[1]);
});

// ── Frame statistics ────────────────────────────────────────────────

test('frame statistics: face and gaze percentages, reasons, confidence and EAR distributions', () => {
  const { D } = load();
  const stats = new D.FrameStats();
  const add = (n, f) => { for (let i = 0; i < n; i++) stats.add(frame(f)); };
  add(10, { reason: 'no_face' });
  add(20, { reason: 'ok', ear: 0.25, threshold: 0.11, conf: 0.95 });
  add(10, { reason: 'eyes_closed', ear: 0.05, threshold: 0.11, conf: 0.5 });
  add(5, { reason: 'ok', ear: 0.14, threshold: 0.11, conf: 0.55 });
  const s = stats.summary();
  assert.equal(s.frames, 45);
  assert.ok(near(s.facePct, 35 / 45 * 100));
  assert.ok(near(s.gazePct, 25 / 45 * 100));
  assert.deepEqual({ ...s.reasons }, { no_face: 10, ok: 25, eyes_closed: 10 });
  assert.equal(s.confidence.n, 35);
  assert.ok(near(s.confidence.p50, 0.95, 0.051));
  assert.equal(s.ear.threshold, 0.11);
  assert.equal(s.ear.open.n, 50);            // 25 frames × 2 eyes
  assert.equal(s.ear.closed.n, 20);
  assert.ok(near(s.ear.open.p50, 0.25, 0.006));
  assert.ok(near(s.ear.closed.p95, 0.05, 0.006));
  // Frames counted as open at 0.11 that the default threshold (0.18) would count as closed.
  assert.ok(near(s.ear.openBelowDefault, 10 / 50));
  assert.ok(stats.describe().length > 3);
  stats.reset();
  assert.equal(stats.summary().frames, 0);
});

// ── Eyes open / closed check ────────────────────────────────────────

test('eyes open/closed check: phases follow the clock, and the first moments of each are not counted', () => {
  const { D } = load();
  const check = new D.EarCheck();
  check.start(0);
  assert.equal(check.phase(100).name, 'up');
  assert.equal(check.phase(3100).name, 'down');
  assert.equal(check.phase(6100).name, 'closed');
  assert.equal(check.phase(8100), null, 'finished after 8 s');
  check.add(frame({ ear: 0.3 }), 200);        // settling: ignored
  check.add(frame({ ear: 0.3 }), 1000);       // counted
  const r = check.result(0.18);
  assert.equal(r.phases[0].n, 1);
});

test('eyes open/closed check: says how the current threshold classifies open and closed eyes', () => {
  const { D } = load();
  const check = new D.EarCheck();
  check.start(0);
  const feed = (from, to, ear) => { for (let t = from; t < to; t += 33) check.add(frame({ ear }), t); };
  feed(800, 3000, 0.28);                      // looking up: wide open
  feed(3800, 6000, 0.15);                     // looking down: lids lower
  feed(6700, 8000, 0.06);                     // closed
  const at18 = check.result(0.18);
  assert.equal(at18.enough, true);
  assert.ok(near(at18.openAsClosed, 0.5, 0.05), 'at 0.18 the looking-down half of open frames count as closed');
  assert.equal(at18.closedAsOpen, 0);
  assert.ok(near(at18.openLow, 0.15) && near(at18.closedHigh, 0.06));
  assert.equal(at18.separable, true);
  const at11 = check.result(0.11);
  assert.equal(at11.openAsClosed, 0);
  assert.equal(at11.closedAsOpen, 0);
  assert.ok(D.EarCheck.describe(at11, 0.11).join('\n').includes('0.11'));
});

test('eyes open/closed check: reports too little data when the face was missing', () => {
  const { D } = load();
  const check = new D.EarCheck();
  check.start(0);
  for (let t = 800; t < 8000; t += 33) check.add(frame({ reason: 'no_face' }), t);
  assert.equal(check.result(0.18).enough, false);
});
