'use strict';
// Phase A (diagnosis): the caregiver dashboard's diagnostics — the live-feed
// overlay and direction inset, frame statistics and the eyes open/closed check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv, GAZE_MODULES, ROOT } = require('./helpers/browser-env');

function recordingContext() {
  const calls = [];
  const ctx = { calls };
  for (const fn of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'closePath', 'fill', 'stroke',
                    'moveTo', 'lineTo', 'fillRect', 'strokeRect']) ctx[fn] = (...a) => calls.push([fn, ...a]);
  ctx.arc = (x, y, r) => calls.push(['arc', x, y, r]);
  ctx.fillText = (t, x, y) => calls.push(['fillText', String(t), x, y]);
  return ctx;
}

function setup() {
  const env = createEnv();
  const settings = { dwellTimeMs: 1200, smoothingFactor: 0.35, activeEye: 'both', earThreshold: 0.11, alarmVolume: 0.7 };
  env.window.LumiStore = {
    DEFAULT_SETTINGS: { earThreshold: 0.18 },
    getSettings: () => settings, updateSetting: (k, v) => { settings[k] = v; }, addAlertLog() {},
    getTypedLogs: () => [], getSymptomLogs: () => [], getAlertLogs: () => [],
  };
  const el = (id, opts = {}) => env.element({ id, ...opts });
  const video = el('caregiverVideo', { tag: 'video' });
  video.videoWidth = 1280; video.videoHeight = 720;
  const canvas = el('caregiverCanvas', { tag: 'canvas', rect: { left: 0, top: 0, width: 400, height: 300 } });
  let ctx = recordingContext();
  canvas.getContext = () => ctx;
  const toggle = el('diagOverlayToggle', { tag: 'input' });
  toggle.checked = false;
  for (const id of ['diagStatsBtn', 'diagStatsReset', 'earCheckBtn', 'earCheckCancel']) el(id, { tag: 'button' });
  for (const id of ['diagStatsOut', 'earCheckOut', 'earCheckText', 'noticeBanner', 'noticeText', 'diagReadout']) el(id);
  el('earCheckOverlay', { classes: ['hidden'] });
  el('earCheckDot', { classes: ['hidden'] });
  env.load(...GAZE_MODULES, 'gaze-engine.js', 'diagnostics.js', 'app.js');
  const gaze = env.get('LumiGaze');
  gaze._buildSubsystems();
  gaze.isTracking = true;
  const app = env.get('EyeApp');
  app._bindDiagnostics();
  return { env, app, gaze, canvas, toggle,
           ctx: () => ctx, freshCtx: () => { ctx = recordingContext(); return ctx; },
           text: (id) => env.document.getElementById(id).textContent };
}

function info({ reason = 'ok', ear = 0.25, raw = { x: 0.5, y: 0.5 }, face = reason !== 'no_face' } = {}) {
  const eye = (side, cx) => ({ side, iris: { x: cx, y: 0.45 }, corners: [{ x: cx - 0.03, y: 0.45 }, { x: cx + 0.03, y: 0.45 }],
                               lids: [{ x: cx, y: 0.44 }, { x: cx, y: 0.46 }], ear, open: ear > 0.11, used: true });
  return face
    ? { face: true, reason, confidence: 0.9, earThreshold: 0.11, pose: { yaw: 0, pitch: 0, roll: 0 },
        eyes: [eye('right', 0.3), eye('left', 0.6)], raw, gaze: reason === 'ok' ? { x: 1, y: 1 } : null }
    : { face: false, reason: 'no_face', confidence: 0, earThreshold: 0.11, eyes: [], pose: null, raw: null, gaze: null };
}

const arcs = (ctx) => ctx.calls.filter((c) => c[0] === 'arc');

// ── The old amber crosshair (display bugs found in Phase A) ─────────

test('the feed canvas is not CSS-mirrored: mirroring is done once, in the mapping', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rule = css.match(/\.feed-canvas\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /scaleX\(-1\)/, 'a mirrored canvas also mirrors its text and doubles the flip');
  assert.match(css.match(/\.feed-video\s*\{([^}]*)\}/)[1], /scaleX\(-1\)/, 'the video itself is shown mirrored');
  const { app } = setup();
  assert.equal(app.FEED_MIRRORED, true, 'the mapping knows the video is mirrored');
});

test('direction inset: eyes turned to the screen\'s left put the dot left of the inset centre', () => {
  // A raised iris-in-eye ratio means the eyes turned to the screen's left (the
  // engine's uncalibrated mapping uses x = 1 - ratio). The old crosshair drew
  // (1 - ratio) on a CSS-mirrored canvas, so it moved the opposite way.
  const s = setup();
  s.app._onFrameInfo(info({ raw: { x: 0.65, y: 0.5 } }));
  const left = arcs(s.ctx()).pop();
  s.freshCtx();
  s.app._onFrameInfo(info({ raw: { x: 0.35, y: 0.5 } }));
  const right = arcs(s.ctx()).pop();
  assert.ok(left[1] < right[1], `left ${left[1]} should be < right ${right[1]}`);
});

// ── Detection overlay ───────────────────────────────────────────────

test('overlay: off by default; when switched on, iris centres are drawn at their place on the video', () => {
  const s = setup();
  const f = info();
  s.app._onFrameInfo(f);
  assert.equal(arcs(s.ctx()).length, 1, 'only the direction inset while the overlay is off');
  s.toggle.checked = true;
  s.toggle.dispatchEvent(new Event('change'));
  s.freshCtx();
  s.app._onFrameInfo(f);
  const D = s.env.get('LumiDiagnostics');
  const map = D.feedMapping(1280, 720, 400, 300, true);
  for (const e of f.eyes) {
    const p = map(e.iris.x, e.iris.y);
    assert.ok(arcs(s.ctx()).some((a) => Math.abs(a[1] - p.x) < 1e-6 && Math.abs(a[2] - p.y) < 1e-6));
  }
  assert.match(s.text('diagReadout'), /EAR R 0\.25/, 'the words go in the box under the video');
  s.toggle.checked = false;
  s.toggle.dispatchEvent(new Event('change'));
  assert.equal(s.text('diagReadout'), '', 'and the box empties when the overlay is off');
});

test('overlay: nothing is drawn while the camera is stopped', () => {
  const s = setup();
  s.gaze.isTracking = false;
  s.app._onFrameInfo(info());
  assert.equal(arcs(s.ctx()).length, 0);
});

// ── Frame statistics ────────────────────────────────────────────────

test('frame statistics: collected only while switched on, and reset on request', () => {
  const s = setup();
  const btn = s.env.document.getElementById('diagStatsBtn');
  s.app._onFrameInfo(info());
  btn.click();                                  // start
  for (let i = 0; i < 3; i++) s.app._onFrameInfo(info());
  s.app._onFrameInfo(info({ reason: 'no_face' }));
  btn.click();                                  // stop
  s.app._onFrameInfo(info());
  assert.match(s.text('diagStatsOut'), /Frames: 4\b/);
  assert.match(s.text('diagStatsOut'), /with a face: 75\.0%/);
  s.env.document.getElementById('diagStatsReset').click();
  assert.match(s.text('diagStatsOut'), /Frames: 0\b/);
});

// ── Eyes open / closed check ────────────────────────────────────────

test('eyes open/closed check: needs the camera running', () => {
  const s = setup();
  s.gaze.isTracking = false;
  s.env.document.getElementById('earCheckBtn').click();
  assert.equal(s.env.document.getElementById('earCheckOverlay').classList.contains('hidden'), true);
  assert.match(s.text('noticeText'), /camera/i);
});

test('eyes open/closed check: guides through the steps, chimes for closing and opening, then reports', () => {
  const s = setup();
  let chimes = 0;
  s.app._chime = () => chimes++;
  s.env.document.getElementById('earCheckBtn').click();
  const overlay = s.env.document.getElementById('earCheckOverlay');
  assert.equal(overlay.classList.contains('hidden'), false);
  assert.match(s.text('earCheckText'), /look at the dot/i);
  const run = (ms, f) => { for (let t = 0; t < ms; t += 33) { s.env.clock.advance(33); s.app._onFrameInfo(f); } };
  run(3000, info({ ear: 0.28 }));
  run(3000, info({ ear: 0.16 }));
  assert.match(s.text('earCheckText'), /close your eyes/i);
  assert.equal(chimes, 1, 'a chime tells the patient to close their eyes');
  run(2100, info({ ear: 0.05 }));
  assert.equal(chimes, 2, 'a second chime tells them to open');
  assert.equal(overlay.classList.contains('hidden'), true);
  const out = s.text('earCheckOut');
  assert.match(out, /Threshold now 0\.11/);
  assert.match(out, /separate between/);
});

test('eyes open/closed check: can be cancelled', () => {
  const s = setup();
  s.env.document.getElementById('earCheckBtn').click();
  s.env.clock.advance(500);
  s.env.document.getElementById('earCheckCancel').click();
  assert.equal(s.env.document.getElementById('earCheckOverlay').classList.contains('hidden'), true);
  assert.match(s.text('earCheckOut'), /cancelled/i);
});
