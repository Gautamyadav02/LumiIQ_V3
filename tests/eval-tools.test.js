'use strict';
// Phase B: the evaluation tools — metrics (eval/metrics.js), the session
// recorder (eval/session-recorder.js) and the offline replay (eval/replay.js).
// Every expected value below is worked out by hand in the comments.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../eval/metrics.js');

const near = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= eps;

// 30 cm wide screen shown in 1500 px: 0.02 cm per px. Viewed from 60 cm.
const GEOM = M.geometry({ distanceCm: 60, screenWidthCm: 30, screenWidthPx: 1500 });

// ── Pixels to degrees of visual angle ───────────────────────────────

test('metrics: pixels convert to degrees of visual angle from distance and screen size', () => {
  // 100 px = 2 cm; atan(2 / 60) = 1.9092°
  assert.ok(near(M.pxToDeg(100, GEOM), Math.atan(2 / 60) * 180 / Math.PI));
  assert.ok(near(M.pxToDeg(100, GEOM), 1.9092, 1e-4));
  assert.equal(M.pxToDeg(0, GEOM), 0);
});

test('metrics: without a valid distance and screen width there are no degrees, only pixels', () => {
  assert.equal(M.geometry({ distanceCm: 60, screenWidthPx: 1500 }), null);
  assert.equal(M.geometry({ distanceCm: 0, screenWidthCm: 30, screenWidthPx: 1500 }), null);
  assert.equal(M.pxToDeg(100, null), null);
  const acc = M.accuracy([{ x: 510, y: 500 }], { x: 500, y: 500 }, null);
  assert.equal(acc.px, 10);
  assert.equal(acc.deg, null);
});

// ── Accuracy, precision, 95th percentile ────────────────────────────

const TARGET = { x: 500, y: 500 };
const CROSS = [{ x: 500, y: 500 }, { x: 510, y: 500 }, { x: 490, y: 500 }, { x: 500, y: 510 }, { x: 500, y: 490 }];

test('metrics: accuracy is the mean distance from the target, with x and y separately', () => {
  const a = M.accuracy(CROSS, TARGET, GEOM);
  assert.equal(a.n, 5);
  assert.ok(near(a.px, 8));              // (0 + 10 + 10 + 10 + 10) / 5
  assert.ok(near(a.x.px, 4));            // mean |dx| = (0 + 10 + 10 + 0 + 0) / 5
  assert.ok(near(a.y.px, 4));
  assert.ok(near(a.biasX.px, 0) && near(a.biasY.px, 0));   // signed mean: no systematic offset
  assert.ok(near(a.deg, M.pxToDeg(8, GEOM)));
  assert.ok(near(a.x.deg, M.pxToDeg(4, GEOM)));
});

test('metrics: a constant offset is all accuracy error and no precision error', () => {
  const shifted = Array.from({ length: 6 }, () => ({ x: 520, y: 485 }));
  const a = M.accuracy(shifted, TARGET, GEOM);
  assert.ok(near(a.px, 25));             // hypot(20, 15)
  assert.ok(near(a.x.px, 20) && near(a.y.px, 15));
  assert.ok(near(a.biasX.px, 20) && near(a.biasY.px, -15));
  const p = M.precision(shifted, GEOM);
  assert.ok(near(p.px, 0) && near(p.x.px, 0) && near(p.y.px, 0));
});

test('metrics: precision is the RMS spread around the samples\' own mean', () => {
  const p = M.precision(CROSS, GEOM);
  assert.ok(near(p.px, Math.sqrt(400 / 5)));   // distances to the mean (500,500): 0,10,10,10,10
  assert.ok(near(p.x.px, Math.sqrt(200 / 5))); // x deviations: 0,10,-10,0,0
  assert.ok(near(p.y.px, Math.sqrt(200 / 5)));
  assert.ok(near(p.deg, M.pxToDeg(Math.sqrt(80), GEOM)));
});

test('metrics: the 95th-percentile error (nearest rank)', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({ x: 500 + (i + 1), y: 500 }));   // errors 1..100
  const p = M.p95(samples, TARGET, GEOM);
  assert.equal(p.px, 95);
  assert.ok(near(p.deg, M.pxToDeg(95, GEOM)));
  assert.equal(M.percentile([3, 1, 2], 0.5), 2);
});

test('metrics: no samples means no number, never zero', () => {
  for (const r of [M.accuracy([], TARGET, GEOM), M.precision([], GEOM), M.p95([], TARGET, GEOM), M.fixationJitter([], GEOM)]) {
    assert.equal(r.n, 0);
    assert.equal(r.px, null);
    assert.equal(r.deg, null);
  }
  assert.equal(M.precision([{ x: 1, y: 1 }], GEOM).px, null, 'one sample has no spread');
  assert.equal(M.percentile([], 0.95), null);
});

// ── Selection test ──────────────────────────────────────────────────

const TRIALS = [
  { prompted: 'H', outcome: 'correct', timeMs: 1800, selections: [{ label: 'H', correct: true }] },
  { prompted: 'E', outcome: 'correct', timeMs: 3000, selections: [{ label: 'W', correct: false }, { label: 'E', correct: true }] },
  { prompted: 'L', outcome: 'missed', timeMs: null, selections: [{ label: 'K', correct: false }, { label: 'O', correct: false }] },
  { prompted: 'P', outcome: 'missed', timeMs: null, selections: [] },
];

test('metrics: wrong selections, missed prompts and time per correct selection', () => {
  assert.equal(M.wrongSelections(TRIALS), 3);            // W, K, O
  assert.equal(M.missedSelections(TRIALS), 2);           // L and P timed out
  assert.equal(M.timePerCorrectSelection(TRIALS), 2400); // (1800 + 3000) / 2
  const s = M.selectionSummary(TRIALS);
  assert.deepEqual({ trials: s.trials, selections: s.selections, correct: s.correct, wrong: s.wrong, missed: s.missed },
                   { trials: 4, selections: 5, correct: 2, wrong: 3, missed: 2 });
  assert.equal(s.wrongPct, 60);                          // 3 of 5 selections hit another target
  assert.equal(s.missedPct, 50);                         // 2 of 4 prompts timed out
  assert.equal(s.timeMs, 2400);
});

test('metrics: a selection test that never ran has no percentages', () => {
  const s = M.selectionSummary([]);
  assert.equal(s.trials, 0);
  assert.equal(s.wrongPct, null);
  assert.equal(s.missedPct, null);
  assert.equal(s.timeMs, null);
  assert.equal(M.timePerCorrectSelection([{ outcome: 'missed', selections: [] }]), null);
});

test('metrics: false activations per minute of rest', () => {
  assert.equal(M.falseActivationsPerMin(3, 120000), 1.5);
  assert.equal(M.falseActivationsPerMin(0, 120000), 0);
  assert.equal(M.falseActivationsPerMin(2, 0), null, 'no rest period, no rate');
});

// ── Lag and jitter ──────────────────────────────────────────────────

test('metrics: settling time is when the gaze enters the zone and stays there', () => {
  const centre = { x: 800, y: 400 };
  // Approaches over 300 ms, overshoots out of the 50 px zone at 330 ms, then settles from 400 ms.
  const path = [
    { t: 0, x: 200, y: 400 }, { t: 100, x: 500, y: 400 }, { t: 200, x: 700, y: 400 },
    { t: 300, x: 790, y: 400 },               // inside, but only briefly
    { t: 330, x: 870, y: 400 },               // overshoot: outside again
    { t: 400, x: 810, y: 400 }, { t: 500, x: 805, y: 400 }, { t: 600, x: 800, y: 400 },
    { t: 700, x: 802, y: 400 }, { t: 800, x: 799, y: 400 },
  ];
  assert.equal(M.settlingTime(path, centre, 50, 300), 400);
  assert.equal(M.settlingTime(path.slice(0, 5), centre, 50, 300), null, 'never settled');
  assert.equal(M.settlingTime([], centre, 50, 300), null);
});

test('metrics: fixation jitter is the RMS of the frame-to-frame movement', () => {
  const zigzag = [0, 2, 0, 2, 0].map((dx, i) => ({ t: i * 33, x: 500 + dx, y: 300 }));
  const j = M.fixationJitter(zigzag, GEOM);
  assert.equal(j.n, 4);                    // four steps between five samples
  assert.ok(near(j.px, 2));                // every step is 2 px
  assert.ok(near(j.deg, M.pxToDeg(2, GEOM)));
  assert.ok(near(M.fixationJitter(zigzag.map((s) => ({ ...s, x: 500 })), GEOM).px, 0));
});

// ── Mean ± SD across sessions ───────────────────────────────────────

test('metrics: mean and sample standard deviation across sessions, ignoring missing values', () => {
  const s = M.meanSd([10, 12, null, 14, undefined]);
  assert.equal(s.n, 3);
  assert.equal(s.mean, 12);
  assert.equal(s.sd, 2);                   // sqrt(((−2)² + 0² + 2²) / (3 − 1))
  assert.deepEqual(M.meanSd([7]), { n: 1, mean: 7, sd: null });
  assert.deepEqual(M.meanSd([]), { n: 0, mean: null, sd: null });
});

// ════════════════════════════════════════════════════════════════════
//  Session recorder
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionRecorder } = require('../eval/session-recorder.js');
const F = require('../gaze/gaze-features.js');

/** A recorder on a controllable clock. */
function recorder() {
  const clock = { t: 0 };
  const rec = new SessionRecorder({ now: () => clock.t, wallNow: () => new Date('2026-10-14T09:00:00Z'), random: () => 0.123456 });
  return { rec, clock };
}

const START = {
  consent: true,
  setup: { distanceCm: 60, screenWidthCm: 30.5, lighting: 'daylight', note: '' },
  screen: { width: 1440, height: 900, dpr: 2 },
  settings: { dwellTimeMs: 1200, smoothingFactor: 0.35, earThreshold: 0.18 },
  settingsBefore: { dwellTimeMs: 600, smoothingFactor: 0.45, earThreshold: 0.1 },
};

/** An engine frame record, as LumiGaze.onFrameInfo delivers it while captureRaw is on. */
function info({ reason = 'ok', t = 0, cal = false, extra = {} } = {}) {
  const face = reason !== 'no_face';
  const eye = (side, ear) => ({ side, iris: { x: 0.4, y: 0.45 }, corners: [], lids: [], ear, open: ear > 0.18, used: true });
  return {
    t, face, reason, eyeMode: face ? 'both' : 'none', confidence: face ? 0.87654321 : 0, earThreshold: 0.18,
    eyes: face ? [eye('right', 0.2512345678), eye('left', 0.27)] : [],
    pose: face ? { yaw: 1.23456789, pitch: -2.5, roll: 0.25 } : null,
    features: face ? [0.51234567891, 0.5, 0.52, 0.49, 1.23456789, -2.5, 0.25, 0.26, 0.12, 0.1] : null,
    pred: reason === 'ok' ? { x: 700.123456, y: 450.987654 } : null,
    gaze: reason === 'ok' ? { x: 702.5, y: 449.25 } : null,
    tGaze: reason === 'ok' ? t : null,
    calSample: cal,
    lm: face ? F.RECORD_INDICES.flatMap((_, i) => [0.3 + i * 0.01234567891, 0.4, -0.01]) : undefined,
    matrix: face ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, -1.25, -60.123456789, 1] : undefined,
    ...extra,
  };
}

const row = (session, i) => Object.fromEntries(session.frameFields.map((f, k) => [f, session.frames[i][k]]));

test('recorder: nothing is recorded without explicit consent', () => {
  for (const consent of [false, undefined, null, 'yes', 1]) {
    const { rec } = recorder();
    assert.throws(() => rec.start({ ...START, consent }), /consent/i, `consent: ${consent}`);
    assert.equal(rec.recording, false);
    assert.equal(rec.frame(info()), false, 'frames are ignored');
  }
  const { rec } = recorder();
  assert.equal(rec.frame(info()), false, 'and before start() too');
  rec.start(START);
  assert.equal(rec.recording, true);
  assert.equal(rec.frame(info()), true);
  const s = rec.finish();
  assert.deepEqual(s.consent, { given: true, at: '2026-10-14T09:00:00.000Z' });
});

test('recorder: a session has an id, the setup, the screen and the settings before and after the reset', () => {
  const { rec } = recorder();
  rec.start(START);
  const s = rec.finish();
  assert.equal(s.format, 'lumiiq-eval-session');
  assert.equal(s.version, 2);
  assert.match(s.id, /^2026-10-14T09-00-00Z-[a-z0-9]{4}$/);
  assert.deepEqual(s.setup, START.setup);
  assert.deepEqual(s.screen, START.screen);
  assert.deepEqual(s.settings, START.settings);
  assert.deepEqual(s.settingsBefore, START.settingsBefore);
  assert.deepEqual(s.engine.landmarkIndices, F.RECORD_INDICES);
});

test('recorder: each frame is one compact row of numbers, with landmarks and head matrix alongside', () => {
  const { rec, clock } = recorder();
  rec.start(START);
  clock.t = 33.3333333;
  rec.frame(info({ t: 33.3333333 }));
  rec.frame(info({ reason: 'no_face', t: 66 }));
  const s = rec.finish();
  assert.equal(s.frames.length, 2);
  const a = row(s, 0);
  assert.equal(a.t, 33.33);
  assert.equal(s.enums.reason[a.reason], 'ok');
  assert.equal(s.enums.eyeMode[a.eyeMode], 'both');
  assert.equal(a.face, 1);
  assert.equal(a.conf, 0.8765);
  assert.equal(a.earR, 0.25123);
  assert.equal(a.yaw, 1.235);
  assert.equal(a.f0, 0.512346);
  assert.deepEqual([a.predX, a.predY, a.gazeX, a.gazeY], [700.12, 450.99, 702.5, 449.25]);
  assert.equal(s.landmarks[0].length, F.RECORD_INDICES.length * 3);
  assert.equal(s.landmarks[0][3], 0.312346);       // rounded to 6 decimals
  assert.equal(s.matrices[0][14], -60.12346);
  const b = row(s, 1);
  assert.equal(s.enums.reason[b.reason], 'no_face');
  assert.equal(b.face, 0);
  assert.equal(b.f0, null);
  assert.equal(b.predX, null);
  assert.equal(s.landmarks[1], null);
  assert.equal(s.matrices[1], null);
});

test('recorder: only known numeric fields are copied, so no image or video can get into a session', () => {
  const { rec } = recorder();
  rec.start(START);
  rec.frame(info({ extra: {
    image: 'data:image/png;base64,' + 'A'.repeat(5000), video: { frame: 'B'.repeat(5000) },
    canvas: {}, raw: { x: 0.5, y: 0.5, pixels: new Array(100).fill(255) },
  } }));
  const s = rec.finish();
  const json = JSON.stringify(s);
  assert.doesNotMatch(json, /data:image|AAAAAAAA|BBBBBBBB|pixels/);
  assert.deepEqual(SessionRecorder.validate(s), []);
  for (const frame of s.frames) assert.ok(frame.every((v) => v === null || typeof v === 'number'));
});

test('recorder: phases and targets know which frames they cover', () => {
  const { rec, clock } = recorder();
  rec.start(START);
  rec.setPhase('validation', { calibration: 'cal9' });
  rec.showTarget({ id: 'c1', group: 'corner', x: 0.04, y: 0.05 });
  for (let i = 0; i < 3; i++) { clock.t += 33; rec.frame(info({ t: clock.t })); }
  rec.showTarget({ id: 'h1', group: 'header', x: 0.3, y: 0.04 });
  for (let i = 0; i < 2; i++) { clock.t += 33; rec.frame(info({ t: clock.t })); }
  rec.hideTarget();
  rec.setPhase('rest');
  clock.t += 33; rec.frame(info({ t: clock.t }));
  const s = rec.finish();
  assert.deepEqual(s.targets.map((t) => [t.phase, t.id, t.group, t.x, t.y, t.frame0, t.frame1]),
    [['validation', 'c1', 'corner', 0.04, 0.05, 0, 3], ['validation', 'h1', 'header', 0.3, 0.04, 3, 5]]);
  assert.deepEqual(s.targets.map((t) => [t.t0, t.t1]), [[0, 99], [99, 165]]);
  assert.deepEqual(s.phases.map((p) => [p.name, p.frame0, p.frame1]), [['validation', 0, 5], ['rest', 5, 6]]);
  assert.equal(s.phases[0].calibration, 'cal9');
  rec.start(START);
  rec.setPhase('validation', { name: 'sneaky', frame0: 99 });
  rec.showTarget({ id: 'a', x: 0.5, y: 0.5, phase: 'sneaky', frame0: 99 });
  const again = rec.finish();
  assert.deepEqual([again.phases[0].name, again.phases[0].frame0], ['validation', 0], 'extra data cannot overwrite a phase\'s own fields');
  assert.deepEqual([again.targets[0].phase, again.targets[0].frame0], ['validation', 0]);
});

test('recorder: each calibration point keeps the frames it was built from', () => {
  const { rec, clock } = recorder();
  rec.start(START);
  rec.setPhase('calibration');
  rec.calibrationStart('cal9', 9);
  const feed = (n, cal) => { for (let i = 0; i < n; i++) { clock.t += 33; rec.frame(info({ reason: 'calibrating', t: clock.t, cal })); } };
  feed(4, true);                       // eye still travelling to the target
  rec.calibrationClear();              // the app discards those
  feed(2, true);
  feed(1, false);                      // a blink: not a sample
  feed(3, true);
  rec.calibrationPoint({ index: 0, total: 9, target: { x: 0.08, y: 0.08 }, samples: 5, accepted: 5, rejected: 0 });
  feed(2, true);
  rec.calibrationPoint({ index: 1, total: 9, target: { x: 0.5, y: 0.08 }, samples: 2, accepted: 2, rejected: 0 });
  rec.calibrationEnd({ report: { ok: true, rating: 'Good', accuracyPx: 88, cvMethod: 'loto' }, model: { version: 3, degree: 2 } });
  const s = rec.finish();
  assert.equal(s.calibrations.length, 1);
  const c = s.calibrations[0];
  assert.equal(c.name, 'cal9');
  assert.equal(c.points, 9);
  assert.deepEqual(c.targets.map((t) => [t.index, t.x, t.y, t.frames]),
    [[0, 0.08, 0.08, [4, 5, 7, 8, 9]], [1, 0.5, 0.08, [10, 11]]]);
  assert.equal(c.report.rating, 'Good');
  assert.equal(c.model.version, 3);
});

test('recorder: selection trials, the rest period, layouts and notes are kept', () => {
  const { rec, clock } = recorder();
  rec.start(START);
  rec.layout('keyboard', [{ label: 'H', x: 700.123, y: 500.5, w: 132, h: 148 }]);
  rec.selectionTrial({ mode: 'dwell', index: 0, prompted: 'H', promptT: 10, outcome: 'correct', timeMs: 1800.4,
                       selections: [{ t: 1810.4, label: 'H', correct: true }] });
  rec.restResult({ mode: 'both', durationMs: 120000, activations: [{ t: 5000, label: 'G' }] });
  clock.t = 42;
  rec.note('alarm', { type: 'FACE_NOT_DETECTED' });
  const s = rec.finish({ label: 'live real', cal9: { accuracyPx: 80 } });
  assert.deepEqual(s.layouts.keyboard, [{ label: 'H', x: 700.12, y: 500.5, w: 132, h: 148 }]);
  assert.equal(s.selections[0].prompted, 'H');
  assert.equal(s.rest.activations.length, 1);
  assert.deepEqual(s.events, [{ t: 42, name: 'alarm', data: { type: 'FACE_NOT_DETECTED' } }]);
  assert.equal(s.summary.label, 'live real');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'a session is plain JSON');
});

test('recorder: validate() rejects sessions without consent, of another format, or with non-numeric data', () => {
  const make = () => { const { rec } = recorder(); rec.start(START); rec.frame(info()); return rec.finish(); };
  assert.deepEqual(SessionRecorder.validate(make()), []);
  const bad = (change) => { const s = make(); change(s); return SessionRecorder.validate(s).join(' | '); };
  assert.match(bad((s) => { s.consent.given = false; }), /consent/);
  assert.match(bad((s) => { delete s.consent; }), /consent/);
  assert.match(bad((s) => { s.format = 'something-else'; }), /format/);
  assert.match(bad((s) => { s.version = 1; }), /version/);
  assert.match(bad((s) => { s.id = '../../etc/passwd'; }), /id/);
  assert.match(bad((s) => { s.frames[0][0] = 'x'; }), /frame/);
  assert.match(bad((s) => { s.setup.note = 'data:image/png;base64,AAAA'; }), /image|text/);
  assert.match(bad((s) => { s.events.push({ t: 1, name: 'n', data: { blob: 'z'.repeat(400) } }); }), /text/);
  assert.match(SessionRecorder.validate(null).join(' '), /object/);
});

test('recorder: a finished session can be written to a folder as <id>.json, and is never overwritten', () => {
  const { rec } = recorder();
  rec.start(START);
  rec.frame(info());
  const s = rec.finish();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiiq-sessions-'));
  try {
    const file = SessionRecorder.writeToDir(s, dir);
    assert.equal(path.basename(file), `${s.id}.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), s);
    assert.throws(() => SessionRecorder.writeToDir(s, dir), /exists/);
    assert.throws(() => SessionRecorder.writeToDir({ ...s, consent: { given: false } }, dir), /consent/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════
//  Session analysis (shared by the wizard's summary and the replay)
// ════════════════════════════════════════════════════════════════════

/**
 * A hand-built session on a 1000×1000 px screen (30 cm wide, viewed from 60 cm):
 * frames every 100 ms; `gazeAt(t)` gives the smoothed gaze of each frame.
 */
function tinySession(build) {
  const { rec, clock } = recorder();
  rec.start({ ...START, screen: { width: 1000, height: 1000, dpr: 1 }, setup: { distanceCm: 60, screenWidthCm: 30 } });
  const frame = (gaze) => {
    rec.frame({ ...info({ t: clock.t }), gaze, pred: gaze });
    clock.t += 100;
  };
  build({ rec, clock, frame });
  return rec.finish();
}

test('analysis: a target\'s samples are the frames inside the time window after it appeared', () => {
  const s = tinySession(({ rec, frame }) => {
    rec.setPhase('validation', { name: 'val9' });
    rec.showTarget({ id: 'i1', group: 'interior', x: 0.5, y: 0.5, set: 'val9' });
    for (let i = 0; i < 10; i++) frame({ x: 500 + i, y: 500 });          // t = 0, 100, … 900
    rec.hideTarget();
  });
  const samples = M.targetSamples(s, s.targets[0], [300, 700]);
  assert.deepEqual(samples.map((p) => [p.t, p.x]), [[300, 503], [400, 504], [500, 505], [600, 506]]);
  assert.equal(M.targetSamples(s, s.targets[0], [5000, 6000]).length, 0);
});

test('analysis: a validation set is summarised per target, then averaged over targets', () => {
  const s = tinySession(({ rec, frame }) => {
    rec.setPhase('validation', { name: 'val9' });
    rec.showTarget({ id: 'a', group: 'header', x: 0.2, y: 0.1, set: 'val9' });     // at (200, 100) px
    for (let i = 0; i < 20; i++) frame({ x: 230, y: 100 });                        // 30 px right, no spread
    rec.showTarget({ id: 'b', group: 'interior', x: 0.8, y: 0.6, set: 'val9' });   // at (800, 600) px
    for (let i = 0; i < 20; i++) frame({ x: 800, y: i % 2 ? 610 : 590 });          // ±10 px in y, no bias
    rec.hideTarget();
  });
  const v = M.validationSummary(s, { set: 'val9' }, [500, 1600]);
  assert.equal(v.targets, 2);
  assert.equal(v.samples, 22);                               // 11 frames in the window per target
  assert.ok(near(v.accuracy.px, (30 + 10) / 2));             // mean of the two targets' accuracies
  assert.ok(near(v.accuracy.x.px, (30 + 0) / 2));
  assert.ok(near(v.accuracy.y.px, (0 + 10) / 2));
  assert.ok(near(v.precision.x.px, 0));
  assert.ok(v.precision.y.px > 4.9 && v.precision.y.px <= 5); // target b: SD of ±10 is ~10; averaged with 0
  assert.equal(v.p95.px, 30);                                // pooled errors: eleven 30s and eleven 10s
  assert.ok(near(v.accuracy.deg, (M.pxToDeg(30, { distanceCm: 60, cmPerPx: 0.03 }) + M.pxToDeg(10, { distanceCm: 60, cmPerPx: 0.03 })) / 2));
  const header = M.validationSummary(s, { set: 'val9', groups: ['header'] }, [500, 1600]);
  assert.equal(header.targets, 1);
  assert.ok(near(header.accuracy.px, 30));
});

test('analysis: a set with no usable samples has no numbers', () => {
  const s = tinySession(({ rec, frame }) => {
    rec.setPhase('validation', { name: 'val9' });
    rec.showTarget({ id: 'a', group: 'header', x: 0.2, y: 0.1, set: 'val9' });
    for (let i = 0; i < 20; i++) frame(null);                 // eyes closed throughout
    rec.hideTarget();
  });
  const v = M.validationSummary(s, { set: 'val9' }, [500, 1600]);
  assert.equal(v.targets, 0);
  assert.equal(v.accuracy.px, null);
  assert.equal(v.p95.px, null);
  assert.equal(M.validationSummary(s, { set: 'val16' }, [500, 1600]).targets, 0);
});

test('analysis: fixation jitter and settling time for one smoothing level', () => {
  const s = tinySession(({ rec, frame }) => {
    rec.setPhase('fixation', { smoothing: 0.35 });
    rec.showTarget({ id: 'fix', group: 'lag', x: 0.5, y: 0.5, smoothing: 0.35 });
    for (let i = 0; i < 50; i++) frame({ x: 500 + (i % 2 ? 3 : 0), y: 500 });     // 3 px steps
    rec.setPhase('jumps', { smoothing: 0.35 });
    rec.showTarget({ id: 'j0', group: 'lag', x: 0.8, y: 0.5, smoothing: 0.35 });   // gaze arrives after 400 ms
    for (let i = 0; i < 20; i++) frame({ x: i < 4 ? 500 + i * 60 : 790, y: 500 });
    rec.hideTarget();
  });
  const lag = M.lagSummary(s, 0.35);
  assert.ok(near(lag.jitter.px, 3));
  assert.equal(lag.jumps, 1);
  assert.equal(lag.settled, 1);
  assert.equal(lag.settlingMs, 400);
  assert.equal(M.lagSummary(s, 0.06).jitter.px, null, 'not measured at this smoothing');
});

test('analysis: the whole session in one call, from the recorded gaze or from a replayed one', () => {
  const s = tinySession(({ rec, frame }) => {
    rec.setPhase('validation', { name: 'val9' });
    rec.showTarget({ id: 'a', group: 'interior', x: 0.5, y: 0.5, set: 'val9' });
    for (let i = 0; i < 20; i++) frame({ x: 520, y: 500 });
    rec.hideTarget();
    rec.selectionTrial({ mode: 'dwell', index: 0, prompted: 'H', promptT: 0, outcome: 'correct', timeMs: 2000, selections: [{ t: 2000, label: 'H', correct: true }] });
    rec.selectionTrial({ mode: 'blink', index: 0, prompted: 'H', promptT: 0, outcome: 'missed', timeMs: null, selections: [] });
    rec.restResult({ mode: 'both', durationMs: 120000, activations: [{ t: 1, label: 'Q' }, { t: 2, label: 'W' }] });
  });
  const a = M.analyseSession(s);
  assert.ok(near(a.validation.val9.standard.accuracy.px, 20));
  assert.equal(a.validation.val16.standard.targets, 0);
  assert.equal(a.selection.dwell.timeMs, 2000);
  assert.equal(a.selection.blink.missedPct, 100);
  assert.equal(a.rest.perMin, 1);
  // The same analysis on another gaze track (what the replay produces): 50 px off instead of 20.
  const replayed = s.frames.map(() => ({ x: 550, y: 500 }));
  assert.ok(near(M.analyseSession(s, { gaze: replayed }).validation.val9.standard.accuracy.px, 50));
});
