'use strict';
// Phase C, C1: the live check of the head-turn gain and sign (LumiGaze.debugHeadComp).
// Part 1: the maths in gaze/gaze-features.js. Part 2: the engine's console helper.
//
// C1 adds back `gain · sin(head angle)` to the eye features, with the gain 0.4 and the sign + built
// in. Both are assumptions about a real camera that only a real head can confirm. These tests show
// that the check measures what it claims on a SYNTHETIC head, a simple geometric model of an eye.
// They say nothing about how a real webcam behaves: that is what the helper is for.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHead, rng, F } = require('./helpers/head3d');
const { setupEngine } = require('./helpers/engine');

const SETTINGS = { earThreshold: 0.18, activeEye: 'both', swapEyes: false };
const sinDeg = (d) => Math.sin((d * Math.PI) / 180);
const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} is not within ${tol} of ${expected}`);

// ── headCompFrame: one frame, measured three ways ───────────────────

test('facing the camera with the eyes straight ahead: image, head-frame and compensated features are all 0.5, pose 0', () => {
  const head = makeHead();
  const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 } });
  const f = F.headCompFrame(lm, matrix, SETTINGS, { aspect: head.aspect });
  for (const variant of ['image', 'head', 'comp']) {
    assert.equal(f[variant].length, 4, `${variant}: lx ly rx ry`);
    f[variant].forEach((v, i) => near(v, 0.5, 1e-3, `${variant}[${i}]`));
  }
  near(f.yaw, 0, 1e-9, 'yaw');
  near(f.pitch, 0, 1e-9, 'pitch');
});

test('compensated = head-frame + gain·sin(angle): the turn goes into lx and rx, the nod into ly and ry', () => {
  const head = makeHead();
  const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 }, yaw: 10, pitch: -6 });
  const f = F.headCompFrame(lm, matrix, SETTINGS, { aspect: head.aspect, headGain: 0.4 });
  near(f.yaw, 10, 1e-6, 'yaw');
  near(f.pitch, -6, 1e-6, 'pitch');
  // Worked by hand: sin 10° = 0.17364817766693, sin 6° = 0.10452846326765.
  for (const i of [0, 2]) near(f.comp[i] - f.head[i], 0.4 * 0.17364817766693, 1e-9, `x feature ${i}`);
  for (const i of [1, 3]) near(f.comp[i] - f.head[i], 0.4 * -0.10452846326765, 1e-9, `y feature ${i}`);
});

test('"image" is what the engine computes with C1 off, "comp" what it computes with C1 on: the two things being compared are the real ones', () => {
  const head = makeHead();
  const { lm, matrix } = head.frame({ target: { x: 0.3, y: 0.6 }, yaw: 8, pitch: 4 });
  const f = F.headCompFrame(lm, matrix, SETTINGS, { aspect: head.aspect, headGain: 0.4 });
  const live = (options) => F.extract(lm, matrix, SETTINGS, { aspect: head.aspect, ...options }).features.slice(0, 4);
  assert.deepEqual(f.image, live({}), 'Phase B');
  assert.deepEqual(f.comp, live({ headFrame: true, headGain: 0.4 }), 'C1');
  assert.deepEqual(f.head, live({ headFrame: true, headGain: 0 }), 'C1 before the add-back');
  assert.notDeepEqual(f.image, f.comp, 'the two really differ for a turned head');
});

test('without a gain in opts the compensated column uses the gain C1 itself uses; a gain in opts replaces it', () => {
  const head = makeHead();
  const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 }, yaw: 10 });
  const SIN_10 = 0.17364817766693;
  const c1Gain = F.improvementOptions(F.flags(['C1'])).features.headGain;
  assert.notEqual(c1Gain, 0, 'C1 has a head-turn gain');
  const addedBack = (extra) => {
    const f = F.headCompFrame(lm, matrix, SETTINGS, { aspect: head.aspect, ...extra });
    return f.comp[0] - f.head[0];
  };
  near(addedBack({}), c1Gain * SIN_10, 1e-9, 'default gain');
  near(addedBack({ headGain: 0.2 }), 0.2 * SIN_10, 1e-9, 'gain 0.2');
  near(addedBack({ headGain: 0 }), 0, 1e-12, 'gain 0');
});

test('no comparison is possible without a head matrix, landmark depth or an open eye: null, not made-up numbers', () => {
  const head = makeHead();
  const opts = { aspect: head.aspect };
  const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 }, yaw: 5 });
  assert.ok(F.headCompFrame(lm, matrix, SETTINGS, opts), 'the control frame works');
  assert.equal(F.headCompFrame(lm, null, SETTINGS, opts), null, 'no head matrix');
  assert.equal(F.headCompFrame(lm.map((p) => p && { x: p.x, y: p.y }), matrix, SETTINGS, opts), null, 'no landmark depth');
  // The engine measures the eye opening in image coordinates, so the head's own value is divided by the aspect.
  const shut = makeHead({ ear: 0.02 / head.aspect }).frame({ target: { x: 0.5, y: 0.5 } });
  assert.equal(F.headCompFrame(shut.lm, shut.matrix, SETTINGS, opts), null, 'eyes shut');
});

test('the eye-opening floor of the live engine applies too: a frame the live pipeline drops is dropped here', () => {
  const head = makeHead({ ear: 0.14 / (16 / 9) });          // 0.14 as the engine measures it
  const settings = { ...SETTINGS, earThreshold: 0.10 };      // open for the alarm, below the 0.16 gaze floor
  const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 }, yaw: 5 });
  assert.ok(F.headCompFrame(lm, matrix, settings, { aspect: head.aspect }), 'without the floor the eye is used');
  assert.equal(F.headCompFrame(lm, matrix, settings, { aspect: head.aspect, earFloor: 0.16 }), null);
});

// ── headCompSummary: what the slopes say ────────────────────────────

const TIMES = Array.from({ length: 360 }, (_, i) => i / 30);            // 12 s at 30 frames a second
const YAWS = TIMES.map((t) => 20 * Math.sin((2 * Math.PI * t) / 6));
const PITCHES = TIMES.map((t) => 12 * Math.sin((2 * Math.PI * t) / 4.3));

/** The synthetic head turned and nodded while its eyes stay on one point. */
function headSweep({ ratio = 0.34, target = { x: 0.5, y: 0.5 }, noise = 0.0005, gain = 0.4, seed = 7 } = {}) {
  const head = makeHead({ eyeballRatio: ratio });
  const rand = rng(seed);
  return YAWS.map((yaw, i) => {
    const { lm, matrix } = head.frame({ target, yaw, pitch: PITCHES[i], noise, rand });
    return F.headCompFrame(lm, matrix, SETTINGS, { aspect: head.aspect, headGain: gain });
  }).filter(Boolean);
}

/** Frames from a straight-line model, no head: head-frame feature = 0.5 + slope·sin(angle). For the verdicts alone. */
function lineFrames({ yaws = YAWS, pitches = PITCHES, slopeX = -0.34, slopeY = -0.34, crossX = 0, gain = 0.4, noise = 0, seed = 3 } = {}) {
  const rand = rng(seed);
  return yaws.map((yaw, i) => {
    const sy = sinDeg(yaw), sp = sinDeg(pitches[i]);
    const column = (add) => {
      const x = 0.5 + slopeX * sy + crossX * sp + add * sy;
      const y = 0.5 + slopeY * sp + add * sp;
      return [x + rand() * noise, y + rand() * noise, x + rand() * noise, y + rand() * noise];
    };
    return { yaw, pitch: pitches[i], image: column(0), head: column(0), comp: column(gain) };
  });
}

test('on the synthetic head the summary recovers the gain the eye model has, whichever point the eyes are held on', () => {
  // In the model the iris moves ratio · sin(angle) eye widths against the head turn: that is the gain the data wants.
  for (const [ratio, target] of [[0.25, { x: 0.5, y: 0.5 }], [0.34, { x: 0.5, y: 0.5 }], [0.5, { x: 0.5, y: 0.5 }], [0.34, { x: 0.15, y: 0.85 }]]) {
    const s = F.headCompSummary(headSweep({ ratio, target }), { gain: 0.4 });
    const what = `eyeball ratio ${ratio}, eyes on (${target.x}, ${target.y})`;
    for (const axis of ['x', 'y']) {
      assert.equal(s[axis].verdict, 'sign-ok', `${what}: ${axis}`);
      near(s[axis].gainWanted, ratio, 0.04, `${what}: gain wanted, ${axis}`);
    }
    near(s.x.compSlope, 0.4 - ratio, 0.04, `${what}: what is left after the 0.4 gain, x`);
    // Phase B's features, as they are: sideways the iris moves as far as in the head frame; vertically the
    // ratio is taken against the eyelids, an opening about a third of the eye width, so it swings ~1/0.3 times as far.
    near(s.x.imageSlope, -ratio, 0.05, `${what}: Phase B slope, x`);
    assert.ok(Math.abs(s.y.imageSlope) > 2 * Math.abs(s.y.headSlope), `${what}: Phase B swings far more vertically`);
  }
});

test('a head-frame feature that moves the other way is SIGN WRONG, and adding the gain makes it worse', () => {
  const s = F.headCompSummary(lineFrames({ slopeX: 0.34, slopeY: 0.34 }), { gain: 0.4 });
  for (const axis of ['x', 'y']) {
    assert.equal(s[axis].verdict, 'sign-wrong', axis);
    near(s[axis].gainWanted, -0.34, 1e-9, `gain wanted, ${axis}`);
    near(s[axis].compSlope, 0.74, 1e-9, `compensated slope, ${axis}`);
  }
});

test('too little head movement is "not-moved", judged per axis: a still axis does not spoil the other', () => {
  const small = F.headCompSummary(lineFrames({ yaws: YAWS.map((y) => y * 0.15) }), { gain: 0.4 });   // ±3°
  assert.equal(small.x.verdict, 'not-moved');
  near(small.x.swingDeg, 6, 0.1, 'swing seen');
  assert.equal(small.y.verdict, 'sign-ok', 'the nod was big enough');
  const turnOnly = F.headCompSummary(lineFrames({ pitches: PITCHES.map(() => 0) }), { gain: 0.4 });
  assert.equal(turnOnly.y.verdict, 'not-moved');
  assert.equal(turnOnly.x.verdict, 'sign-ok');
  near(turnOnly.x.gainWanted, 0.34, 1e-9, 'turn alone still gives the gain');
});

test('under a second of frames is "too-few-frames", never a verdict', () => {
  const s = F.headCompSummary(lineFrames().slice(0, 10), { gain: 0.4 });
  assert.equal(s.x.verdict, 'too-few-frames');
  assert.equal(s.y.verdict, 'too-few-frames');
  assert.equal(F.headCompSummary([], { gain: 0.4 }).x.verdict, 'too-few-frames', 'no frames at all');
});

test('eyes that did not counter-rotate, or a head-frame feature that is only noise, is "weak": no verdict on the sign', () => {
  const s = F.headCompSummary(lineFrames({ slopeX: 0, slopeY: 0, noise: 0.01 }), { gain: 0.4 });
  for (const axis of ['x', 'y']) {
    assert.equal(s[axis].verdict, 'weak', axis);
    near(s[axis].gainWanted, 0, 0.05, `gain wanted, ${axis}`);
  }
  assert.equal(F.headCompSummary(lineFrames({ slopeX: 0, slopeY: 0 }), { gain: 0.4 }).x.verdict, 'weak', 'a perfectly flat feature');
});

test('a relation buried in noise is "weak" however the slope came out: no verdict from data that does not follow the angle', () => {
  const s = F.headCompSummary(lineFrames({ slopeX: -0.34, slopeY: -0.34, noise: 0.5 }), { gain: 0.4 });
  assert.ok(s.x.r2 < 0.2 && s.y.r2 < 0.2, `the noise should drown the signal (R² ${s.x.r2.toFixed(2)}, ${s.y.r2.toFixed(2)})`);
  assert.equal(s.x.verdict, 'weak');
  assert.equal(s.y.verdict, 'weak');
});

test('a clean but tiny relation (gain wanted 0.05) is "weak": a head-frame feature that barely moves cannot show the sign', () => {
  const s = F.headCompSummary(lineFrames({ slopeX: -0.05, slopeY: 0.05 }), { gain: 0.4 });
  assert.ok(s.x.r2 > 0.99, 'noise-free, so the fit is exact');
  assert.equal(s.x.verdict, 'weak');
  assert.equal(s.y.verdict, 'weak', 'also with the opposite sign');
});

test('if the turn and the nod move exactly together they cannot be told apart: each is fitted alone, and nothing is NaN', () => {
  const pitches = YAWS.map((y) => (Math.asin(0.5 * sinDeg(y)) * 180) / Math.PI);   // sin(pitch) = ½ sin(yaw), exactly
  const s = F.headCompSummary(lineFrames({ pitches }), { gain: 0.4 });
  for (const axis of ['x', 'y']) {
    assert.equal(s[axis].verdict, 'sign-ok', axis);
    near(s[axis].gainWanted, 0.34, 1e-6, `gain wanted, ${axis}`);
  }
});

test('a nod during a head turn does not bias the turn: the two angles are fitted together', () => {
  // Turn and nod move together (correlated); the x feature also leans on the nod by 0.25 per unit sin(pitch).
  const pitches = TIMES.map((t) => 10 * Math.sin((2 * Math.PI * t) / 6) + 6 * Math.sin((2.3 * 2 * Math.PI * t) / 6));
  const s = F.headCompSummary(lineFrames({ pitches, slopeX: -0.34, crossX: 0.25 }), { gain: 0.4 });
  assert.equal(s.x.verdict, 'sign-ok');
  near(s.x.gainWanted, 0.34, 0.01, 'gain wanted from the turn alone');
});

// ── headCompReport: what the person reads ───────────────────────────

test('the report says SIGN WRONG and the signed gain the data wants when the sign is reversed', () => {
  const s = F.headCompSummary(lineFrames({ slopeX: 0.34, slopeY: 0.34 }), { gain: 0.4 });
  const text = F.headCompReport({ ...s, reason: 'done', seconds: 12, skipped: 0 }).join('\n');
  assert.match(text, /SIGN WRONG/);
  assert.match(text, /-0\.34/);
});

test('the report says sign OK, the gain the data wants, and how far off the gain in use is', () => {
  const s = F.headCompSummary(lineFrames(), { gain: 0.4 });
  const text = F.headCompReport({ ...s, reason: 'done', seconds: 12, skipped: 0 }).join('\n');
  assert.match(text, /sign OK/i);
  assert.match(text, /\+0\.34/);
  assert.match(text, /18% high/, '0.40 against 0.34 is (0.40 − 0.34) ÷ 0.34 = 18% high');
  assert.doesNotMatch(text, /SIGN WRONG/);
});

// ── Part 2: LumiGaze.debugHeadComp, the console helper ──────────────

/** Where the head is at frame i of the standard sweep: ±20° turn every 6 s, ±12° nod every 4.3 s, at 30 frames a second. */
const sweepPose = (i) => ({ yaw: 20 * Math.sin((2 * Math.PI * i) / 180), pitch: 12 * Math.sin((2 * Math.PI * i) / 129) });

/** One camera frame of the synthetic head, through the engine's real frame entry point (33 ms later). */
function showFrame(ctx, head, rand, pose, target = { x: 0.5, y: 0.5 }) {
  const { lm, matrix } = head.frame({ target, ...pose, noise: 0.0005, rand });
  ctx.env.clock.advance(33);
  ctx.gaze._onFrame({ faceLandmarks: [lm], facialTransformationMatrixes: [matrix] });
}

function sweep(ctx, head, frames = 400, seed = 7) {
  const rand = rng(seed);
  for (let i = 0; i < frames; i++) showFrame(ctx, head, rand, sweepPose(i));
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const quiet = () => {};

test('debugHeadComp: after its 12 seconds it resolves with the sign and the gain the data wants, and prints the verdict', async () => {
  const ctx = setupEngine();
  const lines = [];
  const done = ctx.gaze.debugHeadComp({ seconds: 12, log: (line) => lines.push(line) });
  sweep(ctx, makeHead({ eyeballRatio: 0.3 }), 400);
  const s = await done;
  assert.equal(s.reason, 'done');
  for (const axis of ['x', 'y']) {
    assert.equal(s[axis].verdict, 'sign-ok', axis);
    near(s[axis].gainWanted, 0.3, 0.04, `gain wanted, ${axis}`);
  }
  assert.ok(s.frames >= 350 && s.frames <= 370, `12 s of frames, got ${s.frames}`);
  assert.match(lines.join('\n'), /sign OK/i, 'the verdict is printed');
});

test('debugHeadComp is passive: the engine gives exactly the same results with it running, and nothing it owns is touched', async () => {
  const without = setupEngine(), probed = setupEngine();
  const switches = plain(probed.gaze.improvements), calibration = probed.gaze.calibration;
  probed.gaze.setImprovements = () => { throw new Error('the check must not switch improvements'); };
  const done = probed.gaze.debugHeadComp({ seconds: 12, log: quiet });
  const head = makeHead(), randA = rng(5), randB = rng(5);
  for (let i = 0; i < 400; i++) {
    showFrame(without, head, randA, sweepPose(i));
    showFrame(probed, head, randB, sweepPose(i));
    assert.deepEqual(plain(probed.gaze.lastFrameInfo), plain(without.gaze.lastFrameInfo), `frame ${i}`);
  }
  assert.equal((await done).reason, 'done', 'the check really ran');
  assert.deepEqual(plain(probed.gaze.improvements), switches);
  assert.equal(probed.gaze.calibration, calibration, 'the calibration in use is the very same object');
  assert.equal(probed.gaze.isCalibrated, true);
  assert.equal(probed.store.saved, undefined, 'nothing was saved');
  assert.equal(probed.fired.length, without.fired.length, 'the same dwell selections');
  assert.equal(probed.progress.length, without.progress.length, 'the same dwell progress');
});

test('however a check ends, the engine\'s own feature extraction is back exactly as it was, and another check can start', async () => {
  const head = makeHead();
  const endings = [
    ['done', 'done', (ctx) => sweep(ctx, head, 400)],
    ['stopped', 'stopped', (ctx) => { sweep(ctx, head, 60); ctx.gaze.debugHeadComp('stop'); }],
    ['a calibration starts', 'interrupted', (ctx) => { sweep(ctx, head, 60); ctx.gaze.startCalibration(5); sweep(ctx, head, 1); }],
    ['a recording starts', 'interrupted', (ctx) => { sweep(ctx, head, 60); ctx.gaze.captureRaw = true; sweep(ctx, head, 1); }],
    ['no frames arrive', 'timeout', (ctx) => ctx.env.clock.advance(20000)],
  ];
  for (const [what, reason, act] of endings) {
    const ctx = setupEngine();
    const before = ctx.gaze._extractFeatures;
    const done = ctx.gaze.debugHeadComp({ seconds: 12, log: quiet });
    act(ctx);
    assert.equal((await done).reason, reason, what);
    assert.equal(ctx.gaze._extractFeatures, before, `${what}: extraction restored`);
    ctx.gaze.captureRaw = false;
    if (ctx.gaze.isCalibrating) ctx.gaze.cancelCalibration();
    const again = ctx.gaze.debugHeadComp({ log: quiet });                 // not stuck
    await ctx.gaze.debugHeadComp('stop');
    assert.equal((await again).reason, 'stopped', `${what}: a new check can start`);
  }
});

test('an error inside the check ends the check and is logged: the frame itself is processed as usual', async () => {
  const ctx = setupEngine();
  const before = ctx.gaze._extractFeatures;
  ctx.env.get('GazeFeatures').headCompFrame = () => { throw new Error('boom'); };   // fault injection: the probe's own maths
  const logged = [], realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const done = ctx.gaze.debugHeadComp({ seconds: 12, log: quiet });
    sweep(ctx, makeHead(), 5);
    assert.equal((await done).reason, 'error');
  } finally { console.error = realError; }
  assert.equal(logged.length, 1, 'logged once, not once per frame');
  assert.match(logged[0], /boom/);
  assert.equal(ctx.gaze._extractFeatures, before);
  assert.equal(ctx.gaze.lastFrameInfo.reason, 'ok', 'the frame went through the normal pipeline');
  assert.ok(ctx.gaze.lastFrameInfo.features, 'with its features');
});

test('a log function that throws does not stop the check or touch the frame', async () => {
  const ctx = setupEngine();
  const logged = [], realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const done = ctx.gaze.debugHeadComp({ seconds: 12, log: () => { throw new Error('no console'); } });
    sweep(ctx, makeHead(), 400);
    const s = await done;
    assert.equal(s.reason, 'done', 'it ran to the end');
    assert.equal(s.x.verdict, 'sign-ok');
  } finally { console.error = realError; }
  assert.equal(logged.length, 1, 'reported once');
});

test('debugHeadComp refuses to start during a calibration or an evaluation recording, or while another check runs', async () => {
  const ctx = setupEngine({ calibrated: false });
  ctx.gaze.startCalibration(5);
  assert.throws(() => ctx.gaze.debugHeadComp({ log: quiet }), /calibrat/i);
  ctx.gaze.cancelCalibration();
  ctx.gaze.captureRaw = true;
  assert.throws(() => ctx.gaze.debugHeadComp({ log: quiet }), /recording/i);
  ctx.gaze.captureRaw = false;
  const first = ctx.gaze.debugHeadComp({ log: quiet });
  assert.throws(() => ctx.gaze.debugHeadComp({ log: quiet }), /already/i);
  await ctx.gaze.debugHeadComp('stop');
  await first;
  assert.equal(await ctx.gaze.debugHeadComp('stop'), null, 'stopping with nothing running is harmless');
});

test('live lines: the change of each measurement against the first frame, no more often than asked, and compensation keeps lx and rx steadier than Phase B', () => {
  const ctx = setupEngine();
  const records = [];
  ctx.gaze.debugHeadComp({ seconds: 12, every: 500, log: (line, rec) => { if (rec) records.push(rec); } });
  sweep(ctx, makeHead(), 400);
  assert.ok(records.length >= 18 && records.length <= 26, `about two lines a second for 12 s, got ${records.length}`);
  assert.deepEqual(plain(records[0].delta.image), [0, 0, 0, 0], 'the first line is the reference');
  for (let i = 1; i < records.length; i++) assert.ok(records[i].t - records[i - 1].t >= 500, `line ${i} came too soon`);
  const swing = (variant, feature) => Math.max(...records.map((r) => Math.abs(r.delta[variant][feature])));
  for (const feature of [0, 2]) {
    assert.ok(swing('comp', feature) < swing('image', feature), `lx/rx ${feature}: comp ${swing('comp', feature).toFixed(3)} vs image ${swing('image', feature).toFixed(3)}`);
  }
});

test('"comp" is what the engine feeds its model with C1 on, and "image" what it feeds with C1 off, at the camera\'s own aspect ratio', () => {
  for (const [switches, variant] of [['all', 'comp'], ['none', 'image']]) {
    const ctx = setupEngine({ calibrated: false });
    ctx.gaze.setImprovements(switches);
    ctx.gaze.videoElement = { videoWidth: 640, videoHeight: 480 };       // a 4:3 picture, not the 16:9 default
    const head = makeHead({ aspect: 4 / 3 }), rand = rng(11);
    const records = [];
    ctx.gaze.debugHeadComp({ seconds: 5, every: 0, log: (line, rec) => { if (rec) records.push(rec); } });
    let compared = 0;
    for (let i = 0; i < 100; i++) {
      const seen = records.length;
      showFrame(ctx, head, rand, sweepPose(i * 3));
      if (records.length === seen) continue;
      compared++;
      assert.deepEqual(plain(records[records.length - 1][variant]), plain(ctx.gaze.lastFrameInfo.features.slice(0, 4)), `${switches}: frame ${i}`);
    }
    assert.ok(compared >= 90, `${switches}: ${compared} frames compared`);
    ctx.gaze.debugHeadComp('stop');
  }
});

test('the gain option changes what "comp" is tried with and what is left over, and nothing about what the data wants', async () => {
  const run = async (opts) => {
    const ctx = setupEngine();
    const done = ctx.gaze.debugHeadComp({ seconds: 12, log: quiet, ...opts });
    sweep(ctx, makeHead({ eyeballRatio: 0.34 }), 400);
    return done;
  };
  const inUse = await run({}), tuned = await run({ gain: 0.34 });
  near(tuned.gain, 0.34, 1e-12, 'gain tried');
  near(tuned.x.compSlope, 0, 0.03, 'what is left with the right gain');
  assert.ok(inUse.x.compSlope > 0.03, `what is left with the gain in use: ${inUse.x.compSlope.toFixed(3)}`);
  near(tuned.x.gainWanted, inUse.x.gainWanted, 1e-6, 'gain wanted');
});

test('frames the check cannot use (no landmark depth) are counted as skipped and never guessed at', async () => {
  const ctx = setupEngine();
  const head = makeHead(), rand = rng(3);
  const done = ctx.gaze.debugHeadComp({ seconds: 12, log: quiet });
  for (let i = 0; i < 40; i++) {
    const { lm, matrix } = head.frame({ target: { x: 0.5, y: 0.5 }, ...sweepPose(i), noise: 0.0005, rand });
    ctx.env.clock.advance(33);
    ctx.gaze._onFrame({ faceLandmarks: [lm.map((p) => p && { x: p.x, y: p.y })], facialTransformationMatrixes: [matrix] });   // no z
  }
  ctx.gaze.debugHeadComp('stop');
  const s = await done;
  assert.equal(s.skipped, 40);
  assert.equal(s.frames, 0);
  assert.equal(s.x.verdict, 'too-few-frames');
});

test('by default the lines go to the console', async () => {
  const ctx = setupEngine();
  const printed = [], realLog = console.log;
  console.log = (...args) => printed.push(args.join(' '));
  try {
    const done = ctx.gaze.debugHeadComp({ seconds: 3 });
    sweep(ctx, makeHead(), 120);
    await done;
  } finally { console.log = realLog; }
  assert.ok(printed.some((l) => /yaw/.test(l)), 'live lines');
  assert.ok(printed.some((l) => /Head-compensation check/.test(l)), 'the report');
});
