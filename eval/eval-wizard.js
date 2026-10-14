/**
 * LumiIQ — evaluation wizard (Phase B)
 *
 * Guides one recorded evaluation session, for the caregiver/operator, from the
 * Caregiver tab. Ten stages:
 *
 *    1  Consent                     nothing is recorded before it is given
 *    2  Viewing distance, screen    needed for degrees of visual angle
 *    3  Settings reset              the old values are shown first
 *    4  9-point calibration         head still, the app's own timing
 *    5  12 held-out targets         never used for calibration; corners, the
 *                                   header band, the right edge, the interior
 *    6  Head movement               turn, tilt, lean; 4 targets after each
 *    7  Selection test              10 prompted keys by dwell, 10 by blink
 *    8  Rest period                 2 minutes, counting false activations
 *    9  Lag and jitter              fixation and jumping target, smoothing 0.35 and 0.06
 *   10  16-point calibration        then the 12 held-out targets again
 *
 * What it records is described in eval/session-recorder.js: numbers and short
 * labels only, never video or images. During the selection test and the rest
 * period the keyboard is real, but selections are intercepted: nothing is
 * typed or spoken and Nurse Call cannot fire by mistake. Safety alarms stay on.
 *
 * The wizard is a state machine advanced by tick() (once per animation frame)
 * and by the card's buttons, so it runs unchanged on a test clock.
 */
(function (root) {
  'use strict';

  const TARGET = (id, group, x, y) => ({ id, group, x, y });

  const PLAN = {
    // Calibration timing, identical to app.js (_SETTLE_MS, _CAPTURE_MS).
    SETTLE_MS: 500,
    COLLECT_MS: 1100,
    CALIBRATION_RETRIES: 5,          // repeats of one point before the step fails

    // Each validation target is shown for 2.2 s. The standard figures use the
    // calibration timing (500-1600 ms after it appears); the same showing also
    // contains a longer settle (1100-2200 ms) for AUDIT L6. See LumiMetrics.WINDOWS.
    VALIDATION_SHOW_MS: 2200,

    // 12 held-out targets (normalised screen coordinates). None is a point of the
    // 5-, 9-, 16- or 25-point calibration grids (which use 0.08 … 0.92).
    VALIDATION_TARGETS: [
      TARGET('i1', 'interior', 0.22, 0.25), TARGET('h1', 'header', 0.30, 0.04),
      TARGET('c2', 'corner', 0.96, 0.05), TARGET('r1', 'rightEdge', 0.95, 0.30),
      TARGET('i2', 'interior', 0.78, 0.25), TARGET('h2', 'header', 0.70, 0.04),
      TARGET('c1', 'corner', 0.04, 0.05), TARGET('i3', 'interior', 0.22, 0.75),
      TARGET('c3', 'corner', 0.04, 0.95), TARGET('i4', 'interior', 0.78, 0.75),
      TARGET('r2', 'rightEdge', 0.95, 0.70), TARGET('c4', 'corner', 0.96, 0.95),
    ],

    // After each head movement the four interior targets are measured again.
    HEAD_POSES: [
      { id: 'turnLeft', axis: 'yaw', title: 'Turn your head LEFT', text: 'Turn your head a little to the LEFT, about 5 degrees, and keep it there. Keep looking at the screen.' },
      { id: 'turnRight', axis: 'yaw', opposite: 'turnLeft', title: 'Turn your head RIGHT', text: 'Now turn your head a little to the RIGHT, about 5 degrees past straight ahead, and keep it there.' },
      { id: 'tiltUp', axis: 'pitch', title: 'Tilt your head UP', text: 'Face forward again, then tilt your head UP a little, about 5 degrees, and keep it there.' },
      { id: 'tiltDown', axis: 'pitch', opposite: 'tiltUp', title: 'Tilt your head DOWN', text: 'Now tilt your head DOWN a little, about 5 degrees below level, and keep it there.' },
      { id: 'leanCloser', axis: 'scale', sign: 1, title: 'Lean CLOSER', text: 'Level your head, then lean a little CLOSER to the screen, about 5 cm, and stay there.' },
      { id: 'leanFarther', axis: 'scale', sign: -1, title: 'Lean BACK', text: 'Now lean a little BACK from where you started, about 5 cm, and stay there.' },
      { id: 'neutral', axis: 'neutral', title: 'Back to the start', text: 'Return to the position you sat in at the beginning: head level, facing the screen, at the starting distance.' },
    ],
    POSE_ANGLE_DEG: [3.5, 8],        // accepted head turn or tilt
    POSE_SCALE: [0.06, 0.2],         // accepted change of apparent face size when leaning
    POSE_NEUTRAL: { deg: 2, scale: 0.04 },
    POSE_HOLD_MS: 800,               // the position must be held this long

    // Selection test: prompted keys, spread over the keyboard.
    SELECTION_KEYS: ['Q', 'P', 'A', 'L', 'G', 'Z', 'M', 'T', 'SPACE', '⌫'],
    SELECTION_TIMEOUT_MS: 10000,     // no correct selection by then = missed
    SELECTION_GAP_MS: 1000,          // pause between prompts

    REST_MS: 120000,

    // Lag and jitter, measured at each smoothing level.
    SMOOTHING_LEVELS: [0.35, 0.06],
    FIXATION_MS: 5000,
    JUMP_MS: 2000,
    JUMP_TARGETS: [[0.25, 0.5], [0.75, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]],
  };

  const STAGES = 10;
  const CONSENT_TEXT =
    'This records one evaluation session of the eye tracking, for research.\n\n' +
    'What is recorded: numbers only. Timestamps, positions of face landmarks, eye opening, head angle, ' +
    'where the app estimated you were looking, the targets shown, and which keys were selected in the test.\n\n' +
    'What is NOT recorded: no video, no camera images, no sound, nothing you type.\n\n' +
    'The session is saved on this computer only, in the folder eval/sessions, and can be deleted at any time. ' +
    'You can stop at any point; if you stop, nothing is saved.';
  const SETUP_TEXT =
    'Measure with a ruler or tape:\n' +
    '• Viewing distance: from the eyes to the middle of the screen.\n' +
    '• Screen width: the lit part of the screen, left edge to right edge.\n\n' +
    'These turn pixels into degrees of visual angle. Sit as you normally would, and keep your head still unless asked to move.';

  function buildSteps(plan) {
    const interior = plan.VALIDATION_TARGETS.filter((t) => t.group === 'interior');
    const steps = [
      { kind: 'consent', stage: 1 },
      { kind: 'setup', stage: 2 },
      { kind: 'reset', stage: 3 },
      { kind: 'card', stage: 4, title: '9-point calibration', text: 'Keep your head still and follow the orange dot with your eyes only. Each of the 9 points takes about 2 seconds.' },
      { kind: 'calibration', stage: 4, name: 'cal9', points: 9, label: '9-point calibration' },
      { kind: 'card', stage: 5, title: 'Accuracy check: 12 new targets', text: 'Now 12 targets the app has not seen. Look at each dot until it moves; keep your head still. About 30 seconds.' },
      { kind: 'validation', stage: 5, name: 'val9', calibration: 'cal9', targets: plan.VALIDATION_TARGETS, label: 'Accuracy check' },
      { kind: 'card', stage: 6, title: 'Head movement', text: 'Next you will be asked to move your head a little, six times: turn left and right, tilt up and down, lean closer and back. After each, look at 4 dots. This shows what a small head movement does to the accuracy.' },
    ];
    for (const pose of plan.HEAD_POSES) {
      steps.push({ kind: 'pose', stage: 6, pose });
      if (pose.id !== 'neutral') {
        steps.push({ kind: 'validation', stage: 6, name: `head-${pose.id}`, calibration: 'cal9', targets: interior, pose: pose.id, label: pose.title });
      }
    }
    steps.push(
      { kind: 'card', stage: 7, title: 'Selection test: dwell', text: 'The keyboard will appear. One key at a time is highlighted: select it by LOOKING at it until its ring fills. 10 keys. Nothing is typed or spoken during the test.' },
      { kind: 'selection', stage: 7, mode: 'dwell' },
      { kind: 'card', stage: 7, title: 'Selection test: blink', text: 'The same again, but select by BLINKING: look at the highlighted key, then close your eyes for about half a second and open them. 10 keys.' },
      { kind: 'selection', stage: 7, mode: 'blink' },
      { kind: 'card', stage: 8, title: 'Rest period: 2 minutes', text: 'The keyboard stays on screen for 2 minutes. Do NOT try to select anything: rest, look around the screen, read the keys. Anything that gets selected by itself is counted as a false activation.' },
      { kind: 'rest', stage: 8 },
      { kind: 'card', stage: 9, title: 'Steadiness and speed', text: 'First look steadily at a dot for 5 seconds. Then the dot jumps between places: follow it as fast as you can. This runs twice, with two smoothing settings.' },
    );
    for (const smoothing of plan.SMOOTHING_LEVELS) {
      steps.push({ kind: 'fixation', stage: 9, smoothing }, { kind: 'jumps', stage: 9, smoothing });
    }
    steps.push(
      { kind: 'card', stage: 10, title: '16-point calibration', text: 'Last part: a calibration with 16 points, then the same 12 targets again, to compare with the 9-point calibration. Keep your head still. About a minute.' },
      { kind: 'calibration', stage: 10, name: 'cal16', points: 16, label: '16-point calibration' },
      { kind: 'validation', stage: 10, name: 'val16', calibration: 'cal16', targets: plan.VALIDATION_TARGETS, label: 'Accuracy check (16-point)' },
      { kind: 'summary', stage: 10 },
    );
    return steps;
  }

  function median(values) {
    const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  class EvalWizard {
    /**
     * @param {object} deps  { gaze: LumiGaze, store: LumiStore, app: EyeApp, plan?: overrides }
     */
    constructor(deps = {}) {
      this.gaze = deps.gaze;
      this.store = deps.store;
      this.app = deps.app;
      this.doc = deps.doc || document;
      this.win = deps.win || window;
      this.Recorder = deps.Recorder || root.LumiSessionRecorder;
      this.Metrics = deps.Metrics || root.LumiMetrics;
      this.plan = { ...PLAN, ...(deps.plan || {}) };
      this.now = deps.now || (() => performance.now());
      this.active = false;
      this.recorder = null;
      this.step = null;
      this.st = {};
      this.failed = false;
      this._hooked = null;
      this._bind();
    }

    // ── Wiring ───────────────────────────────────────────────────────

    _el(id) { return this.doc.getElementById(id); }
    _show(id, on) { const e = this._el(id); if (e) e.classList.toggle('hidden', !on); }
    _text(id, text) { const e = this._el(id); if (e) e.textContent = text; }
    _on(id, fn) { const e = this._el(id); if (e) e.addEventListener('click', fn); }

    _bind() {
      this._on('evalStartBtn', () => this.open());
      this._on('evalNextBtn', () => this.next());
      this._on('evalCancelBtn', () => (this.step && this.step.kind === 'summary' ? this.close() : this.cancel()));
      this._on('evalStopBtn', () => this.cancel());
      this._on('evalBannerStop', () => this.cancel());
      this._on('evalDownloadBtn', () => { if (this.session) this.Recorder.download(this.session, this.doc); });
      this._on('evalRestoreBtn', () => this._restorePreviousSettings());
      this.doc.addEventListener('keydown', (e) => {
        if (!this.active || !e || e.code !== 'Space') return;
        const card = this._el('evalCard');
        if (card && !card.classList.contains('hidden')) { if (e.preventDefault) e.preventDefault(); this.next(); }
      });
    }

    // ── Public controls ──────────────────────────────────────────────

    /** Start the wizard (from the Diagnostics card). */
    open() {
      if (this.active) return;
      if (!this.gaze.isTracking) {
        this.app._showNotice('Start the gaze camera first: the evaluation needs the live camera.', 'warning');
        return;
      }
      this.steps = buildSteps(this.plan);
      this.step = null;
      this.active = true;
      this.failed = false;
      this.recorder = null;
      this.session = null;
      this.setup = null;
      this.consentGiven = false;
      this.baseline = null;
      this.signs = {};
      this.settingsBefore = null;
      this._go(0);
      this._loop();
    }

    /** The card's main button (also the space bar). */
    next() {
      if (!this.active || !this.step) return;
      if (this.failed) { this.failed = false; this._go(this.i); return; }   // try the failed step again
      const handler = this[`_next_${this.step.kind}`];
      if (handler) handler.call(this, this.step);
    }

    /** Stop without saving anything, and leave the app as it was found. */
    cancel() {
      if (!this.active) return;
      if (this.gaze.isCalibrating) this.gaze.cancelCalibration();
      const wasRecording = !!this.recorder;
      this._leaveStep();
      this._unhook();
      this.recorder = null;
      this.session = null;
      this._hideAll();
      this.active = false;
      this.step = null;
      this.app._renderTab('dashboard');
      this.app._showNotice(wasRecording
        ? 'Evaluation stopped: nothing was saved. Settings are at their defaults.'
        : 'Evaluation stopped: nothing was saved.', 'info');
    }

    /** Close the finished wizard (the session has been saved or downloaded). */
    close() {
      this._hideAll();
      this.active = false;
      this.step = null;
      this.recorder = null;
      this.app._renderTab('dashboard');
    }

    /** Every engine frame while the wizard is active (wired by app.js). */
    onFrame(info) {
      if (!this.active) return;
      if (this.recorder) this.recorder.frame(info);
      this.lastInfo = info;
      const handler = this.step && this[`_frame_${this.step.kind}`];
      if (handler && !this.failed) handler.call(this, this.step, info);
    }

    tick(now) {
      if (!this.active || !this.step || this.failed) return;
      const handler = this[`_tick_${this.step.kind}`];
      if (handler) handler.call(this, this.step, now);
    }

    _loop() {
      const run = () => {
        if (!this.active) return;
        this.tick(this.now());
        this._raf = this.win.requestAnimationFrame(run);
      };
      this._raf = this.win.requestAnimationFrame(run);
    }

    // ── Moving between steps ─────────────────────────────────────────

    _go(i) {
      this._leaveStep();
      this.i = i;
      this.step = this.steps[i];
      this.st = {};
      this[`_enter_${this.step.kind}`].call(this, this.step, this.now());
    }

    _advance() { this._go(this.i + 1); }

    _leaveStep() {
      const handler = this.step && this[`_exit_${this.step.kind}`];
      if (handler) handler.call(this, this.step);
    }

    /** A step could not be completed: say why, and offer to repeat it. */
    _fail(message) {
      this._leaveStep();
      this.failed = true;
      this._card({ title: 'This step could not be completed', text: message, next: 'Try this step again' });
    }

    // ── Screen modes ─────────────────────────────────────────────────

    _hideAll() {
      for (const id of ['evalOverlay', 'evalCard', 'evalDot', 'evalHud', 'evalStopBtn', 'evalBanner']) this._show(id, false);
    }

    /** An instruction card over the whole screen (gaze cannot select anything behind it). */
    _card({ title, text, detail = '', next = 'Continue', consent = false, setup = false,
            download = false, restore = false, cancel = 'Stop the evaluation' }) {
      this._show('evalBanner', false);
      this._show('evalOverlay', true);
      this._show('evalCard', true);
      this._show('evalDot', false);
      this._show('evalHud', false);
      this._show('evalStopBtn', false);
      this._text('evalStage', `Stage ${this.step.stage} of ${STAGES}`);
      this._text('evalTitle', title);
      this._text('evalText', text);
      this._text('evalDetail', detail);
      this._text('evalError', '');
      this._show('evalConsentBox', consent);
      this._show('evalSetupBox', setup);
      this._show('evalNextBtn', !!next);
      if (next) this._text('evalNextBtn', next);
      this._show('evalCancelBtn', true);
      this._text('evalCancelBtn', cancel);
      this._show('evalDownloadBtn', download);
      this._show('evalRestoreBtn', restore);
    }

    _error(message) { this._text('evalError', message); }

    /** A single dot on a blank screen. `instant`: it jumps instead of gliding like the calibration dot. */
    _dot(target, hud, instant = false) {
      this._show('evalBanner', false);
      this._show('evalOverlay', true);
      this._show('evalCard', false);
      this._show('evalDot', true);
      this._show('evalHud', true);
      this._show('evalStopBtn', true);
      const dot = this._el('evalDot');
      if (dot) {
        dot.classList.toggle('eval-instant', instant);
        dot.style.left = `${target.x * 100}%`;
        dot.style.top = `${target.y * 100}%`;
      }
      if (hud != null) this._text('evalHud', hud);
    }

    /** The real keyboard with a slim banner on top. */
    _banner(text) {
      this._show('evalOverlay', false);
      this._show('evalBanner', true);
      this._text('evalBannerText', text);
    }

    // ── Engine hooks ─────────────────────────────────────────────────

    _hook() {
      const g = this.gaze;
      this._hooked = {
        captureRaw: g.captureRaw, onCalibrationComplete: g.onCalibrationComplete, onCalibrationPoint: g.onCalibrationPoint,
        onCalibrationClear: g.onCalibrationClear, onDwellClick: g.onDwellClick, onEmergencyAlert: g.onEmergencyAlert,
      };
      const saved = this._hooked;
      g.captureRaw = true;
      g.onCalibrationComplete = () => {};                       // the wizard reads the result itself
      g.onCalibrationPoint = (point) => { if (this.recorder) this.recorder.calibrationPoint(point); };
      g.onCalibrationClear = () => { if (this.recorder) this.recorder.calibrationClear(); };
      g.onDwellClick = (el) => this._onActivation(el, saved.onDwellClick);
      g.onEmergencyAlert = (type, details) => {                 // alarms stay on; note that one fired
        if (this.recorder) this.recorder.note('alarm', { type });
        if (saved.onEmergencyAlert) saved.onEmergencyAlert(type, details);
      };
    }

    _unhook() {
      if (!this._hooked) return;
      Object.assign(this.gaze, this._hooked);
      this._hooked = null;
      // The evaluation changed these two on the way; leave them at the defaults.
      const d = this.store.DEFAULT_SETTINGS || {};
      for (const key of ['selectionMode', 'smoothingFactor']) {
        if (d[key] !== undefined && this.store.getSettings()[key] !== d[key]) this.store.updateSetting(key, d[key]);
      }
    }

    /** A gaze selection happened. In the selection test and the rest period it is only counted. */
    _onActivation(el, passOn) {
      const kind = this.step && this.step.kind;
      if (kind === 'selection') return this._selectionMade(el);
      if (kind === 'rest') return this._restActivation(el);
      if (passOn) passOn(el);
    }

    _label(el) {
      if (el.dataset && el.dataset.key) return String(el.dataset.key);
      if (el.id) return String(el.id);
      return String(el.textContent || el.tagName || 'target').trim().slice(0, 20);
    }

    _flash(el) {
      el.classList.add('dwell-fired');
      this.win.setTimeout(() => el.classList.remove('dwell-fired'), 300);
    }

    // ── Stage 1: consent ─────────────────────────────────────────────

    _enter_consent() {
      const box = this._el('evalConsent');
      if (box) box.checked = false;                           // consent is never pre-ticked
      this._card({ title: 'Evaluation session: consent', text: CONSENT_TEXT, consent: true, next: 'I agree: continue', cancel: 'Cancel' });
    }

    _next_consent() {
      const box = this._el('evalConsent');
      if (!box || box.checked !== true) {
        this._error('Tick the box to give consent. Without consent nothing is recorded.');
        return;
      }
      this.consentGiven = true;
      this._advance();
    }

    // ── Stage 2: viewing distance and screen ─────────────────────────

    _enter_setup() {
      this._card({ title: 'Viewing distance and screen width', text: SETUP_TEXT, setup: true, cancel: 'Cancel' });
    }

    _next_setup() {
      const number = (id) => parseFloat((this._el(id) || {}).value);
      const distanceCm = number('evalDistanceCm'), screenWidthCm = number('evalScreenWidthCm');
      if (!(distanceCm >= 20 && distanceCm <= 200)) return this._error('Enter the viewing distance in centimetres (between 20 and 200).');
      if (!(screenWidthCm >= 10 && screenWidthCm <= 200)) return this._error('Enter the screen width in centimetres (between 10 and 200).');
      const textOf = (id) => String((this._el(id) || {}).value || '').trim().slice(0, 80);
      this.setup = { distanceCm, screenWidthCm, lighting: textOf('evalLighting') || 'not stated', note: textOf('evalNote') };
      this._advance();
    }

    // ── Stage 3: settings reset ──────────────────────────────────────

    _enter_reset() {
      const now = this.store.getSettings();
      const defaults = this.store.DEFAULT_SETTINGS || {};
      this.settingsBefore = { ...now };
      const changed = Object.keys(defaults)
        .filter((k) => k !== 'sleepModeUntil' && now[k] !== defaults[k])
        .map((k) => `${k}: ${now[k]} → ${defaults[k]}`);
      this._card({
        title: 'Settings are reset for the test',
        text: 'So that every session is measured the same way, all settings are put back to their defaults now. ' +
              'Your current values are listed below and can be restored at the end.',
        detail: changed.length ? changed.join('\n') : 'All settings are already at their defaults.',
        next: 'Reset settings and start recording',
        cancel: 'Cancel',
      });
    }

    _next_reset() {
      this.store.resetSettings();
      if (this.app._loadSettingsValues) this.app._loadSettingsValues();
      this.recorder = new this.Recorder({ now: this.now });
      this.recorder.start({
        consent: this.consentGiven === true,
        setup: this.setup,
        screen: { width: this.win.innerWidth, height: this.win.innerHeight, dpr: this.win.devicePixelRatio || 1 },
        settings: { ...this.store.getSettings() },
        settingsBefore: this.settingsBefore,
        flags: typeof this.gaze.evalFlags === 'function' ? this.gaze.evalFlags() : {},
      });
      this._hook();
      this._advance();
    }

    _restorePreviousSettings() {
      if (!this.settingsBefore) return;
      for (const [key, value] of Object.entries(this.settingsBefore)) {
        if (key !== 'sleepModeUntil' && this.store.getSettings()[key] !== value) this.store.updateSetting(key, value);
      }
      if (this.app._loadSettingsValues) this.app._loadSettingsValues();
      this._show('evalRestoreBtn', false);
      this._error('Your previous settings are back in use.');
    }

    // ── Instruction cards ────────────────────────────────────────────

    _enter_card(step) { this._card({ title: step.title, text: step.text }); }
    _next_card() { this._advance(); }

    // ── Stages 4 and 10: calibration ─────────────────────────────────

    _enter_calibration(step, now) {
      this.recorder.setPhase('calibration', { calibration: step.name, points: step.points });
      this.recorder.calibrationStart(step.name, step.points);
      const target = this.gaze.startCalibration(step.points);
      this.st = { target, t0: now, cleared: false, retries: 0, computing: false };
      this._dot(target, this._calHud(step));
    }

    _calHud(step) { return `${step.label}: point ${this.st.target.index + 1} of ${this.st.target.total}`; }

    _tick_calibration(step, now) {
      const st = this.st, plan = this.plan;
      const elapsed = now - st.t0;
      if (!st.cleared && elapsed >= plan.SETTLE_MS) {           // the eye has landed: drop what was collected on the way
        this.gaze.clearCalibrationSamples();
        st.cleared = true;
      }
      if (elapsed < plan.SETTLE_MS + plan.COLLECT_MS) return;
      const lastPoint = st.target.index + 1 === st.target.total;
      if (lastPoint && !st.computing) {                         // training blocks the page: let this text show first
        st.computing = true;
        this._text('evalHud', 'Computing the calibration…');
        return;
      }
      const res = this.gaze.captureCalibrationPoint();
      if (res.error === 'insufficient') {
        if (++st.retries > plan.CALIBRATION_RETRIES) {
          this.gaze.cancelCalibration();
          this.recorder.calibrationEnd({ report: { ok: false, reason: 'eyes_not_visible' } });
          return this._fail('The camera could not see open eyes on this point. Check the light and the camera position, make sure the face is in view, then try again.');
        }
        Object.assign(st, { t0: now, cleared: false, computing: false });
        this._text('evalHud', 'Missed it: the same point again');
        return;
      }
      if (res.error) return this._fail('The calibration was interrupted.');
      if (!res.done) {
        Object.assign(st, { target: res.target, t0: now, cleared: false, retries: 0 });
        this._dot(st.target, this._calHud(step));
        return;
      }
      if (!res.report || !res.report.ok) {
        this.recorder.calibrationEnd({ report: res.report || { ok: false } });
        return this._fail('The calibration did not get enough clean samples. Keep your head still, look at each dot until it moves, and try again.');
      }
      this.gaze.acceptCalibration();                            // the evaluation measures this calibration
      this.recorder.calibrationEnd({ report: res.report, model: this.gaze.calibration.toJSON() });
      this._advance();
    }

    _exit_calibration() {
      if (this.gaze.isCalibrating) this.gaze.cancelCalibration();
    }

    // ── Stages 5, 6 and 10: held-out targets ─────────────────────────

    _enter_validation(step, now) {
      this.recorder.setPhase('validation', { set: step.name, calibration: step.calibration, pose: step.pose || null });
      this.st = { k: -1 };
      this._nextTarget(step, now);
    }

    _nextTarget(step, now) {
      const st = this.st;
      st.k++;
      if (st.k >= step.targets.length) {
        this.recorder.hideTarget();
        if (step.name === 'val9') this._setBaselinePose();
        return this._advance();
      }
      const t = step.targets[st.k];
      this.recorder.showTarget({ id: t.id, group: t.group, x: t.x, y: t.y, set: step.name, pose: step.pose || null });
      st.t0 = now;
      this._dot(t, `${step.label}: target ${st.k + 1} of ${step.targets.length}`);
    }

    _tick_validation(step, now) {
      if (now - this.st.t0 >= this.plan.VALIDATION_SHOW_MS) this._nextTarget(step, now);
    }

    /** The head position during the head-still accuracy check: what "moved" is measured from. */
    _setBaselinePose() {
      const s = this.recorder.session;
      const phase = s.phases[s.phases.length - 1];
      const col = (name) => s.frameFields.indexOf(name);
      const rows = s.frames.slice(phase.frame0);
      this.baseline = {
        yaw: median(rows.map((f) => f[col('yaw')])),
        pitch: median(rows.map((f) => f[col('pitch')])),
        scale: median(rows.map((f) => f[col('f8')])),
      };
      this.recorder.note('baselinePose', this.baseline);
    }

    // ── Stage 6: head positions ──────────────────────────────────────

    _enter_pose(step) {
      this.st = { heldSince: null, delta: null };
      this._card({ title: step.pose.title, text: step.pose.text, detail: 'Waiting for the camera…', next: 'Continue with this position' });
    }

    _poseDelta(info) {
      const b = this.baseline;
      if (!b || !info.face || !info.pose || !info.features) return null;
      return { yaw: info.pose.yaw - b.yaw, pitch: info.pose.pitch - b.pitch, scale: b.scale ? info.features[8] / b.scale - 1 : 0 };
    }

    _poseOk(pose, d) {
      const plan = this.plan;
      const within = (v, [lo, hi]) => Math.abs(v) >= lo && Math.abs(v) <= hi;
      if (pose.axis === 'neutral') {
        return Math.abs(d.yaw) < plan.POSE_NEUTRAL.deg && Math.abs(d.pitch) < plan.POSE_NEUTRAL.deg && Math.abs(d.scale) < plan.POSE_NEUTRAL.scale;
      }
      if (pose.axis === 'scale') return Math.sign(d.scale) === pose.sign && within(d.scale, plan.POSE_SCALE);
      const value = d[pose.axis];
      if (!within(value, plan.POSE_ANGLE_DEG)) return false;
      // "Right" must be the other way from "left" (and "down" from "up"), whichever sign the camera gives them.
      const other = pose.opposite ? this.signs[pose.opposite] : null;
      return !other || Math.sign(value) === -other;
    }

    _frame_pose(step, info) {
      const d = this._poseDelta(info);
      if (!d) return;
      const st = this.st, now = this.now();
      st.delta = d;
      const ok = this._poseOk(step.pose, d);
      const pct = Math.round(d.scale * 100);
      this._text('evalDetail',
        `Change from your starting position:\n  turn ${d.yaw.toFixed(1)}°   tilt ${d.pitch.toFixed(1)}°   distance ${pct > 0 ? 'closer' : pct < 0 ? 'farther' : 'same'} (${Math.abs(pct)}%)\n` +
        (ok ? 'Good: hold still…' : 'Move until this says "Good".'));
      if (!ok) { st.heldSince = null; return; }
      if (st.heldSince == null) st.heldSince = now;
      if (now - st.heldSince >= this.plan.POSE_HOLD_MS) this._acceptPose(step, true);
    }

    _next_pose(step) { this._acceptPose(step, false); }

    /** Record the position actually reached (auto: it met the request; otherwise the operator moved on). */
    _acceptPose(step, auto) {
      const d = this.st.delta || { yaw: null, pitch: null, scale: null };
      const axis = step.pose.axis;
      if ((axis === 'yaw' || axis === 'pitch') && d[axis] != null) this.signs[step.pose.id] = Math.sign(d[axis]);
      this.recorder.note('pose', { id: step.pose.id, auto, yaw: d.yaw, pitch: d.pitch, scale: d.scale });
      this._advance();
    }

    // ── Stage 7: selection test ──────────────────────────────────────

    _keyElements() { return Array.from(this.doc.querySelectorAll('.key-btn')); }

    _recordLayout() {
      const rects = Array.from(this.doc.querySelectorAll('.gazeable'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .map(({ el, r }) => ({ label: this._label(el), x: r.left, y: r.top, w: r.width, h: r.height }));
      this.recorder.layout('keyboard', rects);
    }

    _enter_selection(step, now) {
      this.app._renderTab('keyboard');
      this.store.updateSetting('selectionMode', step.mode);
      this.recorder.setPhase('selection', { mode: step.mode });
      this._banner('');
      this._recordLayout();
      this.st = { index: -1, trial: null, gapUntil: now };
    }

    _startTrial(step, now) {
      const st = this.st;
      st.index++;
      if (st.index >= this.plan.SELECTION_KEYS.length) return this._advance();
      const key = this.plan.SELECTION_KEYS[st.index];
      const el = this._keyElements().find((k) => k.dataset && k.dataset.key === key) || null;
      if (el) el.classList.add('eval-prompt');
      st.el = el;
      st.trial = { mode: step.mode, index: st.index, prompted: key, promptT: Math.round(now * 100) / 100, selections: [], outcome: null, timeMs: null };
      const how = step.mode === 'dwell' ? 'look at it until the ring fills' : 'look at it, then close your eyes for half a second';
      this._banner(`Select the highlighted key: ${key}   (${how})   ${st.index + 1} of ${this.plan.SELECTION_KEYS.length}`);
    }

    _endTrial(outcome, now) {
      const st = this.st, trial = st.trial;
      trial.outcome = outcome;
      trial.timeMs = outcome === 'correct' ? Math.round((now - trial.promptT) * 100) / 100 : null;
      this.recorder.selectionTrial(trial);
      if (st.el) st.el.classList.remove('eval-prompt');
      st.trial = null;
      st.el = null;
      st.gapUntil = now + this.plan.SELECTION_GAP_MS;
      this._banner(outcome === 'correct' ? 'Selected.' : 'Time is up for this key.');
    }

    _selectionMade(el) {
      const st = this.st;
      if (!st.trial) return;                                    // between prompts: ignore
      const now = this.now();
      const correct = el === st.el;
      st.trial.selections.push({ t: Math.round(now * 100) / 100, label: this._label(el), correct });
      this._flash(el);
      if (correct) this._endTrial('correct', now);
    }

    _tick_selection(step, now) {
      const st = this.st;
      if (!st.trial) { if (now >= st.gapUntil) this._startTrial(step, now); return; }
      if (now - st.trial.promptT >= this.plan.SELECTION_TIMEOUT_MS) this._endTrial('missed', now);
    }

    _exit_selection() {
      if (this.st.el) this.st.el.classList.remove('eval-prompt');
      this._show('evalBanner', false);
      const d = this.store.DEFAULT_SETTINGS || {};
      if (d.selectionMode !== undefined) this.store.updateSetting('selectionMode', d.selectionMode);
    }

    // ── Stage 8: rest period ─────────────────────────────────────────

    _enter_rest(step, now) {
      this.app._renderTab('keyboard');
      this.recorder.setPhase('rest', { mode: this.store.getSettings().selectionMode });
      if (!this.recorder.session.layouts.keyboard) this._recordLayout();
      this.st = { t0: now, activations: [] };
      this._restBanner(now);
    }

    _restBanner(now) {
      const left = Math.max(0, Math.ceil((this.plan.REST_MS - (now - this.st.t0)) / 1000));
      this._banner(`Rest period: do NOT select anything. Look around or read the keys.   ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`);
    }

    _restActivation(el) {
      this.st.activations.push({ t: Math.round((this.now() - this.st.t0) * 100) / 100, label: this._label(el) });
      this._flash(el);
    }

    _tick_rest(step, now) {
      if (now - this.st.t0 < this.plan.REST_MS) { this._restBanner(now); return; }
      this.recorder.restResult({ mode: this.store.getSettings().selectionMode, durationMs: this.plan.REST_MS, activations: this.st.activations });
      this._advance();
    }

    _exit_rest() { this._show('evalBanner', false); }

    // ── Stage 9: lag and jitter ──────────────────────────────────────

    _enter_fixation(step, now) {
      this.app._renderTab('dashboard');
      this.store.updateSetting('smoothingFactor', step.smoothing);
      this.recorder.setPhase('fixation', { smoothing: step.smoothing });
      const t = { x: 0.5, y: 0.5 };
      this.recorder.showTarget({ id: 'fix', group: 'lag', x: t.x, y: t.y, smoothing: step.smoothing });
      this.st = { t0: now };
      this._dot(t, `Look steadily at the dot (smoothing ${step.smoothing})`, true);
    }

    _tick_fixation(step, now) {
      if (now - this.st.t0 >= this.plan.FIXATION_MS) this._advance();
    }

    _enter_jumps(step, now) {
      this.recorder.setPhase('jumps', { smoothing: step.smoothing });
      this.st = { k: -1 };
      this._nextJump(step, now);
    }

    _nextJump(step, now) {
      const st = this.st;
      st.k++;
      if (st.k >= this.plan.JUMP_TARGETS.length) {
        this.recorder.hideTarget();
        const d = this.store.DEFAULT_SETTINGS || {};
        const lastLevel = step.smoothing === this.plan.SMOOTHING_LEVELS[this.plan.SMOOTHING_LEVELS.length - 1];
        if (lastLevel && d.smoothingFactor !== undefined) this.store.updateSetting('smoothingFactor', d.smoothingFactor);
        return this._advance();
      }
      const [x, y] = this.plan.JUMP_TARGETS[st.k];
      this.recorder.showTarget({ id: `j${st.k}`, group: 'lag', x, y, smoothing: step.smoothing });
      st.t0 = now;
      this._dot({ x, y }, `Follow the dot as fast as you can (smoothing ${step.smoothing})`, true);
    }

    _tick_jumps(step, now) {
      if (now - this.st.t0 >= this.plan.JUMP_MS) this._nextJump(step, now);
    }

    // ── Summary and saving ───────────────────────────────────────────

    _enter_summary() {
      this._unhook();                                           // defaults back, the app's hooks back
      this.app._renderTab('dashboard');
      const recorded = this.recorder.session;
      const summary = { label: 'live real', ...this.Metrics.analyseSession(recorded) };
      this.session = this.recorder.finish(summary);
      this._card({
        title: 'Evaluation complete',
        text: 'Saving the session…',
        detail: this._summaryText(summary),
        next: null, cancel: 'Close', restore: !!this.settingsBefore,
      });
      this.Recorder.upload(this.session, this.win.fetch ? (...a) => this.win.fetch(...a) : undefined).then((res) => {
        if (!this.active || !this.session) return;
        if (res.ok) {
          this._text('evalText', `Saved on this computer as ${res.file}.\nRun "npm run eval:report" to update eval/BASELINE.md.`);
        } else {
          this._text('evalText', 'The session is still held in this page.');
          this._error(`The session was NOT saved (${res.error}). Use "Download the session file" and move the file into eval/sessions/.`);
          this._show('evalDownloadBtn', true);
        }
      });
    }

    /** This session's own figures, for the operator. Labelled: they are from one live session. */
    _summaryText(a) {
      const px = (v) => (v == null ? 'not measured' : `${v.toFixed(0)} px`);
      const both = (m) => (m.px == null ? 'not measured' : `${m.px.toFixed(0)} px` + (m.deg == null ? '' : ` / ${m.deg.toFixed(2)}°`));
      const val = (name, v) => `${name}: accuracy ${both(v.accuracy)} (x ${px(v.accuracy.x.px)}, y ${px(v.accuracy.y.px)}), ` +
                               `precision ${both(v.precision)}, 95% of samples within ${both(v.p95)}`;
      const pct = (v) => (v == null ? 'not measured' : `${v.toFixed(0)}%`);
      const sel = (name, s) => `${name}: wrong ${pct(s.wrongPct)}, missed ${pct(s.missedPct)}, ` +
                               `time per correct selection ${s.timeMs == null ? 'not measured' : (s.timeMs / 1000).toFixed(1) + ' s'}`;
      const lines = [
        'This session only (live real). The report combines all sessions.',
        '',
        val('9-point calibration, 12 new targets', a.validation.val9.standard),
        val('16-point calibration, 12 new targets', a.validation.val16.standard),
        val('Header and right edge (9-point)', a.validation.val9.headerRightEdge),
        val('After a head turn', a.head.turn),
        val('After a head tilt', a.head.tilt),
        val('After leaning', a.head.lean),
        '',
        sel('Selection by dwell', a.selection.dwell),
        sel('Selection by blink', a.selection.blink),
        `False activations at rest: ${a.rest.perMin == null ? 'not measured' : a.rest.perMin.toFixed(1) + ' per minute'}`,
      ];
      for (const [level, lag] of Object.entries(a.lag)) {
        lines.push(`Smoothing ${level}: jitter ${px(lag.jitter.px)}, settling time ` +
                   `${lag.settlingMs == null ? 'not measured' : lag.settlingMs.toFixed(0) + ' ms'} (${lag.settled} of ${lag.jumps} jumps settled)`);
      }
      return lines.join('\n');
    }
  }

  root.LumiEvalWizard = { EvalWizard, PLAN, buildSteps };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LumiEvalWizard;
})(typeof window !== 'undefined' ? window : globalThis);
