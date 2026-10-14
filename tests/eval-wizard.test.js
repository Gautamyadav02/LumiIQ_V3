'use strict';
// Phase B: the evaluation wizard (eval/eval-wizard.js), run on the real gaze
// engine with a simulated person and operator (tests/helpers/wizard.js).
// Every number these runs produce is SYNTHETIC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupWizard, DEFAULTS } = require('./helpers/wizard');
const { ROOT } = require('./helpers/browser-env');
const { SessionRecorder } = require('../eval/session-recorder.js');
const { GazeCalibration } = require('../gaze/gaze-calibration.js');

// A full run takes about ten simulated minutes; most tests shorten the long waits.
const QUICK = { REST_MS: 3000, FIXATION_MS: 2000 };

// The wizard runs in the fake browser's own JavaScript realm: copy values out before comparing.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── The plan ────────────────────────────────────────────────────────

test('plan: 12 validation targets, none of them a calibration point, covering corners, header and right edge', () => {
  const { PLAN } = setupWizard();
  const targets = PLAN.VALIDATION_TARGETS;
  assert.equal(targets.length, 12);
  assert.equal(new Set(targets.map((t) => t.id)).size, 12);
  for (const points of [5, 9, 16, 25]) {
    for (const c of GazeCalibration.buildLayout(points)) {
      for (const t of targets) {
        assert.ok(Math.hypot(t.x - c.x, t.y - c.y) > 0.03, `${t.id} is too close to a ${points}-point calibration target`);
      }
    }
  }
  const group = (g) => targets.filter((t) => t.group === g);
  assert.equal(group('corner').length, 4);
  assert.ok(group('corner').every((t) => (t.x < 0.06 || t.x > 0.94) && (t.y < 0.06 || t.y > 0.94)));
  assert.ok(group('header').length >= 2 && group('header').every((t) => t.y <= 0.06), 'the header band, where the tabs are');
  assert.ok(group('rightEdge').length >= 2 && group('rightEdge').every((t) => t.x >= 0.94), 'the right edge, where Nurse Call is');
  assert.equal(group('interior').length, 4);
});

test('plan: validation uses the calibration timing, and shows each target long enough for a longer settle too', () => {
  const { PLAN, app } = setupWizard();
  assert.equal(PLAN.SETTLE_MS, app._SETTLE_MS);
  assert.equal(PLAN.COLLECT_MS, app._CAPTURE_MS);
  assert.ok(PLAN.VALIDATION_SHOW_MS >= 2 * PLAN.COLLECT_MS);
  assert.equal(PLAN.REST_MS, 120000);
  assert.deepEqual([...PLAN.SMOOTHING_LEVELS], [0.35, 0.06]);
  assert.equal(PLAN.SELECTION_KEYS.length, 10);
});

// ── Starting, consent, setup, reset ─────────────────────────────────

test('it needs the camera running', () => {
  const w = setupWizard();
  w.gaze.isTracking = false;
  w.el.evalStartBtn.click();
  assert.equal(w.wizard.active, false);
  assert.match(w.app.notices[0].message, /camera/i);
});

test('consent: the box starts unticked, and nothing is recorded until it is ticked', () => {
  const w = setupWizard();
  w.el.evalConsent.checked = true;                     // even if the page had it ticked…
  w.el.evalStartBtn.click();
  assert.equal(w.wizard.active, true);
  assert.equal(w.wizard.step.kind, 'consent');
  assert.equal(w.el.evalConsent.checked, false, '…the wizard unticks it');
  assert.match(w.el.evalText.textContent, /no video|not .*video/i);
  w.el.evalNextBtn.click();
  assert.equal(w.wizard.step.kind, 'consent', 'still on the consent screen');
  assert.match(w.el.evalError.textContent, /consent/i);
  w.frames(500);
  assert.equal(w.wizard.recorder, null, 'no recorder exists yet');
  assert.equal(w.gaze.captureRaw, false);
  w.el.evalConsent.checked = true;
  w.el.evalNextBtn.click();
  assert.equal(w.wizard.step.kind, 'setup');
});

test('setup: viewing distance and screen width are required, as plausible numbers', () => {
  const w = setupWizard();
  w.el.evalStartBtn.click();
  w.el.evalConsent.checked = true;
  w.el.evalNextBtn.click();
  for (const [distance, width] of [['', '30'], ['60', ''], ['abc', '30'], ['5', '30'], ['60', '500']]) {
    w.el.evalDistanceCm.value = distance;
    w.el.evalScreenWidthCm.value = width;
    w.el.evalNextBtn.click();
    assert.equal(w.wizard.step.kind, 'setup', `distance "${distance}", width "${width}" is refused`);
    assert.ok(w.el.evalError.textContent.length > 0);
  }
  w.el.evalDistanceCm.value = '62.5';
  w.el.evalScreenWidthCm.value = '30.5';
  w.el.evalLighting.value = 'dim';
  w.el.evalNextBtn.click();
  assert.equal(w.wizard.step.kind, 'reset');
  assert.deepEqual(plain(w.wizard.setup), { distanceCm: 62.5, screenWidthCm: 30.5, lighting: 'dim', note: '' });
});

test('reset: the old settings are shown first, then the defaults apply and recording starts', () => {
  const w = setupWizard({ settings: { dwellTimeMs: 600, smoothingFactor: 0.45, earThreshold: 0.1, selectionMode: 'dwell' } });
  w.runUntil('reset');
  const shown = w.el.evalDetail.textContent;
  assert.match(shown, /dwellTimeMs: 600 → 1200/);
  assert.match(shown, /earThreshold: 0\.1 → 0\.18/);
  assert.match(shown, /selectionMode: dwell → both/);
  assert.doesNotMatch(shown, /activeEye/, 'settings already at their default are not listed');
  assert.equal(w.settings.dwellTimeMs, 600, 'nothing has changed yet');
  w.el.evalNextBtn.click();
  assert.equal(w.settings.dwellTimeMs, 1200);
  assert.equal(w.settings.earThreshold, 0.18);
  assert.equal(w.wizard.recorder.recording, true);
  assert.equal(w.gaze.captureRaw, true);
  assert.equal(w.wizard.recorder.session.settingsBefore.dwellTimeMs, 600);
  assert.equal(w.wizard.recorder.session.settings.dwellTimeMs, 1200);
  assert.deepEqual(plain(w.wizard.recorder.session.screen), { width: 1440, height: 900, dpr: 1 });
});

// ── A complete run ──────────────────────────────────────────────────

test('a complete run: all ten stages in order, saved as one valid session (synthetic person)', async () => {
  const w = setupWizard({ settings: { dwellTimeMs: 600, smoothingFactor: 0.45 } });   // the full, ten-minute plan
  w.el.evalStartBtn.click();
  assert.equal(w.runUntil('summary'), true, `the wizard reached the summary (stopped at "${w.wizard.step && w.wizard.step.kind}")`);
  await w.flush();

  // Saved once, through the local endpoint, and valid.
  assert.equal(w.uploads.length, 1);
  assert.equal(w.uploads[0].url, '/api/eval/session');
  const s = w.uploads[0].session;
  assert.deepEqual(SessionRecorder.validate(s), []);
  assert.equal(s.consent.given, true);
  assert.deepEqual(s.setup, { distanceCm: 60, screenWidthCm: 30.5, lighting: 'daylight', note: '' });
  assert.match(w.el.evalText.textContent, /eval\/sessions\//);

  // The stages, in order.
  const phases = s.phases.map((p) => p.name);
  const order = ['calibration', 'validation', 'selection', 'rest', 'fixation', 'jumps', 'calibration', 'validation'];
  let at = -1;
  for (const name of order) { at = phases.indexOf(name, at + 1); assert.ok(at !== -1, `phase "${name}" is missing or out of order: ${phases.join(', ')}`); }

  // Calibrations: 9 points, then 16; each point knows its frames; the model is stored.
  assert.deepEqual(s.calibrations.map((c) => [c.name, c.points, c.targets.length]), [['cal9', 9, 9], ['cal16', 16, 16]]);
  for (const c of s.calibrations) {
    assert.equal(c.report.ok, true);
    assert.equal(c.report.cvMethod, 'loto');
    assert.equal(c.model.version, 4, 'head-frame features (C1)');
    assert.ok(c.targets.every((t) => t.frames.length >= 12 && t.frames.length === t.samples));
    // When each point was committed (= when the next target appeared), for replaying a settle guard.
    const times = c.targets.map((t) => t.t);
    assert.ok(times.every((t, i) => typeof t === 'number' && t > (i ? times[i - 1] : c.t0) && t <= c.t1), `${c.name}: commit times in order`);
    assert.ok(c.targets.every((t) => t.frames.every((f) => s.frames[f][0] <= t.t)), 'a point\'s frames come before its commit');
  }
  // The camera picture's size: landmarks are normalised by it, so the replay needs its aspect ratio.
  assert.deepEqual(s.camera, { width: 1280, height: 720 });

  // Targets: 12 held-out after each calibration, 4 after each of the 6 head positions.
  const count = (f) => s.targets.filter(f).length;
  assert.equal(count((t) => t.set === 'val9'), 12);
  assert.equal(count((t) => t.set === 'val16'), 12);
  for (const pose of ['turnLeft', 'turnRight', 'tiltUp', 'tiltDown', 'leanCloser', 'leanFarther']) {
    assert.equal(count((t) => t.pose === pose), 4, `4 targets after ${pose}`);
  }
  const poses = s.events.filter((e) => e.name === 'pose').map((e) => [e.data.id, Math.round(e.data.yaw), Math.round(e.data.pitch), Math.round(e.data.scale * 100)]);
  assert.deepEqual(poses, [['turnLeft', 5, 0, 0], ['turnRight', -5, 0, 0], ['tiltUp', 0, -5, 0], ['tiltDown', 0, 5, 0],
                           ['leanCloser', 0, 0, 10], ['leanFarther', 0, 0, -10], ['neutral', 0, 0, 0]]);

  // Selection test: 10 prompts by dwell and 10 by blink, on the real keyboard, nothing actually typed.
  const dwell = s.selections.filter((t) => t.mode === 'dwell'), blink = s.selections.filter((t) => t.mode === 'blink');
  assert.deepEqual(dwell.map((t) => t.prompted), [...w.PLAN.SELECTION_KEYS]);
  assert.deepEqual(blink.map((t) => t.prompted), [...w.PLAN.SELECTION_KEYS]);
  assert.ok(dwell.every((t) => t.outcome === 'correct' && t.timeMs > 1200), 'dwell: every prompt selected, none faster than the dwell time');
  assert.ok(blink.every((t) => t.outcome === 'correct'), 'blink: every prompt selected');
  assert.ok(dwell.every((t) => t.selections.every((x) => x.by === 'dwell')), 'each selection records what made it');
  assert.ok(blink.every((t) => t.selections.every((x) => x.by === 'blink')));
  assert.deepEqual(w.clicks, [], 'no key was really pressed, and Nurse Call never fired');
  assert.ok(s.layouts.keyboard.some((k) => k.label === 'Q') && s.layouts.keyboard.some((k) => k.label === 'nurseCallBtn'));

  // Rest: two minutes, looking at the text display, so no activations.
  assert.equal(s.rest.durationMs, 120000);
  assert.deepEqual(s.rest.activations, []);

  // Lag and jitter at both smoothing levels.
  assert.deepEqual(s.targets.filter((t) => t.id === 'fix').map((t) => t.smoothing), [0.35, 0.06]);
  assert.equal(count((t) => t.phase === 'jumps'), 2 * w.PLAN.JUMP_TARGETS.length);

  // The summary on screen comes from the same analysis the report uses, and is labelled.
  assert.equal(s.summary.label, 'live real');
  const acc = s.summary.validation.val9.standard.accuracy;
  assert.ok(acc.px > 0 && acc.px < 60, `synthetic person: 9-point accuracy ${acc.px.toFixed(1)} px`);
  assert.ok(acc.deg > 0);
  assert.equal(s.summary.selection.dwell.missedPct, 0);
  assert.equal(s.summary.rest.perMin, 0);
  assert.ok(s.summary.lag['0.35'].jitter.px >= 0 && s.summary.lag['0.06'].settlingMs > 0);
  assert.match(w.el.evalDetail.textContent, /9-point/);
  assert.match(w.el.evalDetail.textContent, /px/);

  // Afterwards: defaults are back, the engine's hooks are the app's again.
  assert.equal(w.settings.selectionMode, DEFAULTS.selectionMode);
  assert.equal(w.settings.smoothingFactor, DEFAULTS.smoothingFactor);
  assert.equal(w.gaze.captureRaw, false);
  assert.equal(w.gaze.onDwellClick, w.original.onDwellClick);
  assert.equal(w.gaze.onCalibrationComplete, w.original.onCalibrationComplete);
  assert.equal(w.original.appSawCalibration, undefined, 'the app\'s own calibration screen was never triggered');

  // "Restore my previous settings" puts the caregiver's values back.
  w.el.evalRestoreBtn.click();
  assert.equal(w.settings.dwellTimeMs, 600);
  assert.equal(w.settings.smoothingFactor, 0.45);
});

// ── Individual stages ───────────────────────────────────────────────

test('selection test: a wrong key is counted, and a prompt that is never selected is missed', () => {
  const w = setupWizard({ plan: QUICK });
  w.runUntil('selection');
  w.frames(400);
  const trialKey = w.wizard.st.trial.prompted;
  w.gaze.onDwellClick(w.keys.W);                       // the patient's gaze selects another key
  assert.deepEqual(plain(w.wizard.st.trial.selections).map((x) => [x.label, x.correct]), [['W', false]]);
  assert.deepEqual(w.clicks, [], 'the wrong key is not typed');
  w.me.gaze = { x: 0.02, y: 0.98 };                    // then the person looks away until the time limit
  w.env.hit = () => null;
  w.frames(w.PLAN.SELECTION_TIMEOUT_MS + 500);
  const first = w.wizard.recorder.session.selections[0];
  assert.equal(first.prompted, trialKey);
  assert.equal(first.outcome, 'missed');
  assert.equal(first.timeMs, null);
  assert.equal(first.selections.length, 1);
});

test('rest period: a selection made while resting is a false activation, and types nothing', () => {
  const w = setupWizard({ plan: { ...QUICK, REST_MS: 8000 }, person: { rest: 'stare' } });
  w.runUntil('rest');
  assert.match(w.el.evalBannerText.textContent, /rest|do not/i);
  assert.equal(w.visible(w.el.evalOverlay), false, 'the keyboard is visible: there is something to select by mistake');
  w.runUntil('card');
  const rest = w.wizard.recorder.session.rest;
  assert.equal(rest.durationMs, 8000);
  assert.ok(rest.activations.length >= 1, 'staring at a key for 8 s fires a dwell');
  assert.equal(rest.activations[0].label, 'G');
  assert.equal(rest.activations[0].by, 'dwell');
  assert.deepEqual(w.clicks, []);
});

test('calibration that cannot see the eyes fails honestly and can be retried', () => {
  const w = setupWizard({ plan: QUICK, person: { eyes: 'closed' } });
  w.runUntil('calibration');
  w.frames(30000);
  assert.equal(w.wizard.step.kind, 'calibration');
  assert.equal(w.wizard.failed, true);
  assert.match(w.el.evalTitle.textContent, /could not/i);
  assert.equal(w.gaze.isCalibrating, false);
  assert.equal(w.gaze.isCalibrated, false, 'no calibration was accepted');
});

// ── Cancelling and saving ───────────────────────────────────────────

test('cancelling: nothing is saved, and the app is left as it was found', async () => {
  const w = setupWizard({ plan: QUICK });
  w.runUntil('selection');
  w.frames(300);
  w.el.evalBannerStop.click();
  await w.flush();
  assert.equal(w.wizard.active, false);
  assert.equal(w.uploads.length, 0);
  assert.equal(w.wizard.recorder, null);
  assert.equal(w.gaze.captureRaw, false);
  assert.equal(w.gaze.onDwellClick, w.original.onDwellClick);
  assert.equal(w.settings.selectionMode, DEFAULTS.selectionMode);
  assert.equal(w.visible(w.el.evalBanner), false);
  assert.equal(w.visible(w.el.evalOverlay), false);
  assert.ok(!Object.values(w.keys).some((k) => k.classList.contains('eval-prompt')));
  assert.match(w.app.notices.pop().message, /nothing was saved/i);
});

test('if the server cannot save the session, it says so and offers a download', async () => {
  const w = setupWizard({ plan: QUICK, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  w.el.evalStartBtn.click();
  assert.equal(w.runUntil('summary'), true);
  await w.flush();
  assert.match(w.el.evalError.textContent, /not saved|could not/i);
  assert.equal(w.visible(w.el.evalDownloadBtn), true);
  assert.equal(w.wizard.active, true, 'the session is still held so it can be downloaded');
});

test('an alarm during the evaluation still reaches the app, and is noted in the session', () => {
  const w = setupWizard({ plan: QUICK });
  w.runUntil('validation');
  w.gaze.onEmergencyAlert('FACE_NOT_DETECTED', 'No face detected for 10s');
  assert.deepEqual(w.original.alarms, ['FACE_NOT_DETECTED']);
  assert.deepEqual(plain(w.wizard.recorder.session.events).filter((e) => e.name === 'alarm').map((e) => e.data.type), ['FACE_NOT_DETECTED']);
});

// ── The page ────────────────────────────────────────────────────────

test('index.html: the consent box is not pre-ticked, and the wizard\'s controls are not gaze targets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const consent = html.match(/<input[^>]*id="evalConsent"[^>]*>/);
  assert.ok(consent, 'the consent checkbox exists');
  assert.doesNotMatch(consent[0], /\bchecked\b/);
  for (const id of ['evalStartBtn', 'evalNextBtn', 'evalCancelBtn', 'evalDownloadBtn', 'evalRestoreBtn', 'evalStopBtn', 'evalBannerStop']) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} exists`);
    assert.doesNotMatch(tag[0], /\bgazeable\b/, `${id} must not be a gaze target`);
  }
  for (const id of ['evalOverlay', 'evalCard', 'evalStage', 'evalTitle', 'evalText', 'evalConsentBox', 'evalSetupBox', 'evalDetail',
                    'evalError', 'evalDot', 'evalHud', 'evalBanner', 'evalBannerText', 'evalDistanceCm', 'evalScreenWidthCm',
                    'evalLighting', 'evalNote']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} exists`);
  }
});
