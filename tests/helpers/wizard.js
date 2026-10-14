'use strict';
/**
 * Runs the real evaluation wizard on the real gaze engine in the fake browser,
 * with a simulated person (who looks where the wizard asks) and a simulated
 * operator (who clicks through the instruction cards).
 *
 * The person's eyes follow a simple, known rule:
 *     iris-in-eye ratio = 0.5 ∓ 0.3 × (gaze position − 0.5) + a little noise
 * so a calibration can learn it and a validation should find a small error.
 * Every number such a run produces is SYNTHETIC.
 */
const { createEnv, GAZE_MODULES } = require('./browser-env');
const { faceLandmarks, headMatrix } = require('./landmarks');

const WIDTH = 1440, HEIGHT = 900, FRAME_MS = 33;

const DEFAULTS = {
  dwellTimeMs: 1200, smoothingFactor: 0.35, activeEye: 'both', earThreshold: 0.18, swapEyes: false,
  faceLostAlarmSec: 10, selectionMode: 'both', blinkSelectMs: 500, dwellRepeat: false, alarmVolume: 0.7,
  sleepWakeSec: 5, sleepModeUntil: 0,
};

const WIZARD_IDS = ['evalOverlay', 'evalCard', 'evalStage', 'evalTitle', 'evalText', 'evalConsentBox', 'evalSetupBox',
  'evalDetail', 'evalError', 'evalDot', 'evalHud', 'evalBanner', 'evalBannerText', 'evalStatus'];
const WIZARD_BUTTONS = ['evalStartBtn', 'evalNextBtn', 'evalCancelBtn', 'evalDownloadBtn', 'evalRestoreBtn',
  'evalStopBtn', 'evalBannerStop'];

const ROWS = [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
              ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'], ['SPACE', 'SPEAK', 'CLEAR']];

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
}

/**
 * @param {object} [o]
 * @param {object} [o.plan]       overrides for the wizard's timings (e.g. a short rest period)
 * @param {object} [o.settings]   the caregiver's settings before the evaluation
 * @param {object} [o.person]     { noise, seed, rest: 'idle' | 'stare', eyes: 'ok' | 'closed' }
 * @param {Function} [o.fetch]    the upload stub (default: accepts and remembers the session)
 */
function setupWizard({ plan, settings = {}, person = {}, fetch } = {}) {
  const env = createEnv({ width: WIDTH, height: HEIGHT });
  const current = { ...DEFAULTS, ...settings };
  const alerts = [];
  env.window.LumiStore = {
    DEFAULT_SETTINGS: { ...DEFAULTS },
    getSettings: () => current,
    updateSetting(key, value) { current[key] = value; env.window.dispatchEvent(new Event('lumiiq-settings-changed')); },
    resetSettings() { Object.assign(current, DEFAULTS, { sleepModeUntil: current.sleepModeUntil }); env.window.dispatchEvent(new Event('lumiiq-settings-changed')); },
    addAlertLog(type, details) { alerts.push({ type, details }); },
    getCalibration: () => null,
    saveCalibration(c) { this.savedCalibration = c; },
  };

  // The wizard's own elements.
  const el = {};
  for (const id of WIZARD_IDS) el[id] = env.element({ id, classes: ['hidden'] });
  for (const id of WIZARD_BUTTONS) el[id] = env.element({ id, tag: 'button', classes: id === 'evalStartBtn' ? [] : ['hidden'] });
  el.evalConsent = env.element({ id: 'evalConsent', tag: 'input' });
  el.evalConsent.checked = false;
  for (const id of ['evalDistanceCm', 'evalScreenWidthCm', 'evalLighting', 'evalNote']) el[id] = env.element({ id, tag: 'input' });

  // A keyboard: every key is a gaze target with a rectangle; the text display is not.
  const keys = {};
  const clicks = [];
  const top = 300, keyW = 132, keyH = 140, gap = 8;
  ROWS.forEach((row, r) => {
    const rowW = row.length * keyW + (row.length - 1) * gap;
    row.forEach((k, c) => {
      const rect = { left: (WIDTH - rowW) / 2 + c * (keyW + gap), top: top + r * (keyH + gap), width: keyW, height: keyH };
      const key = env.element({ tag: 'button', classes: ['key-btn', 'gazeable'], dataset: { key: k }, rect });
      key.addEventListener('click', () => clicks.push(k));
      keys[k] = key;
    });
  });
  const nurse = env.element({ id: 'nurseCallBtn', tag: 'button', classes: ['nurse-btn', 'gazeable'],
                              rect: { left: 1240, top: 150, width: 180, height: 100 } });
  nurse.addEventListener('click', () => clicks.push('NURSE'));
  const display = env.element({ id: 'keyboardDisplay', rect: { left: 20, top: 150, width: 1200, height: 100 } });

  // What is under a screen point: the wizard's overlay when it is showing, else a key.
  const visible = (e) => !e.classList.contains('hidden');
  const inside = (e, x, y) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  env.hit = (x, y) => {
    if (visible(el.evalOverlay)) return el.evalOverlay;
    return [...Object.values(keys), nurse, display].find((e) => inside(e, x, y)) || null;
  };

  const uploads = [];
  env.fetch = fetch || (async (url, opts) => {
    uploads.push({ url, session: JSON.parse(opts.body) });
    return { ok: true, status: 201, json: async () => ({ file: `eval/sessions/${JSON.parse(opts.body).id}.json` }) };
  });

  env.load(...GAZE_MODULES, 'gaze-engine.js', 'eval/metrics.js', 'eval/session-recorder.js', 'eval/eval-wizard.js');
  const gaze = env.get('LumiGaze');
  gaze._buildSubsystems();
  gaze.isTracking = true;
  gaze.videoElement = { videoWidth: 1280, videoHeight: 720 };   // the camera picture's size in pixels
  const original = {
    onDwellClick: (target) => { target.click(); },      // what app.js does with a selection
    onCalibrationComplete: () => { original.appSawCalibration = true; },
    onEmergencyAlert: (type) => { original.alarms = (original.alarms || []).concat(type); },
  };
  Object.assign(gaze, { onDwellClick: original.onDwellClick, onCalibrationComplete: original.onCalibrationComplete,
                        onEmergencyAlert: original.onEmergencyAlert });

  const app = {
    _SETTLE_MS: 500, _CAPTURE_MS: 1100, tab: 'dashboard', notices: [],
    _renderTab(tab) { this.tab = tab; },
    _loadSettingsValues() { this.settingsShown = (this.settingsShown || 0) + 1; },
    _showNotice(message, level) { this.notices.push({ message, level }); },
  };
  const { EvalWizard, PLAN } = env.get('LumiEvalWizard');
  const wizard = new EvalWizard({ gaze, store: env.window.LumiStore, app, plan });
  gaze.onFrameInfo = (info) => { if (wizard.active) wizard.onFrame(info); };

  // ── The simulated person ─────────────────────────────────────────
  const rand = rng(person.seed || 1);
  const noise = person.noise != null ? person.noise : 0.0015;
  const me = { gaze: { x: 0.5, y: 0.5 }, want: null, wantSince: 0, pose: { yaw: 0, pitch: 0, scale: 1 }, blink: null };

  /** Where the person intends to look right now (normalised screen position), or null to rest. */
  function intent() {
    if (visible(el.evalOverlay) && visible(el.evalDot)) {
      return { x: parseFloat(el.evalDot.style.left) / 100, y: parseFloat(el.evalDot.style.top) / 100, key: null };
    }
    if (visible(el.evalBanner)) {
      const prompted = Object.values(keys).find((k) => k.classList.contains('eval-prompt'));
      const target = prompted || (person.rest === 'stare' ? keys.G : display);
      const r = target.getBoundingClientRect();
      return { x: (r.left + r.width / 2) / WIDTH, y: (r.top + r.height / 2) / HEIGHT, key: prompted || null };
    }
    return null;
  }

  /** One camera frame: move the eyes (after a reaction time), maybe blink, and feed the engine. */
  function frame() {
    env.clock.advance(FRAME_MS);
    const now = env.clock.now;
    const want = intent();
    const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
    if (!same(want, me.want)) { me.want = want; me.wantSince = now; me.blink = null; }
    const reacted = now - me.wantSince >= 250;                   // saccade latency
    if (want && reacted) me.gaze = { x: want.x, y: want.y };

    // Blink to select: rest on the prompted key, then close the eyes deliberately for 600 ms.
    let closed = person.eyes === 'closed';
    if (want && want.key && env.window.LumiStore.getSettings().selectionMode === 'blink') {
      const rested = now - me.wantSince;
      if (!me.blink && rested >= 1100) me.blink = { from: now };
      if (me.blink) {
        const t = now - me.blink.from;
        if (t < 600) closed = true;
        else if (t > 2500) me.blink = null;                      // not selected: try again
      }
    }
    const ear = closed ? 0.05 : 0.3;
    const lm = faceLandmarks({
      irisX: 0.5 - 0.3 * (me.gaze.x - 0.5) + rand() * noise,
      irisY: 0.5 + 0.3 * (me.gaze.y - 0.5) + rand() * noise,
      openL: ear, openR: ear, scale: me.pose.scale,
    });
    gaze._onFrame({ faceLandmarks: [lm], facialTransformationMatrixes: [headMatrix(me.pose.yaw, me.pose.pitch)] });
  }

  const POSES = { turnLeft: { yaw: 5 }, turnRight: { yaw: -5 }, tiltUp: { pitch: -5 }, tiltDown: { pitch: 5 },
                  leanCloser: { scale: 1.1 }, leanFarther: { scale: 0.9 }, neutral: {} };

  /** The operator: answers whatever card is showing. Returns false when there is nothing to do. */
  function operate() {
    const step = wizard.step;
    if (!step || !visible(el.evalOverlay) || !visible(el.evalCard)) return false;
    if (step.kind === 'pose') { me.pose = { yaw: 0, pitch: 0, scale: 1, ...POSES[step.pose.id] }; return false; }
    if (step.kind === 'summary') return false;
    if (step.kind === 'consent') el.evalConsent.checked = true;
    if (step.kind === 'setup') { el.evalDistanceCm.value = '60'; el.evalScreenWidthCm.value = '30.5'; el.evalLighting.value = 'daylight'; }
    el.evalNextBtn.click();
    return true;
  }

  /** Run until the wizard reaches `kind` (default: the summary), or for at most `maxMs` of simulated time. */
  function runUntil(kind = 'summary', maxMs = 20 * 60 * 1000) {
    if (!wizard.active) el.evalStartBtn.click();
    const end = env.clock.now + maxMs;
    while (wizard.active && env.clock.now < end) {
      if (wizard.step && wizard.step.kind === kind) return true;
      operate();
      frame();
    }
    return wizard.active && wizard.step && wizard.step.kind === kind;
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));   // let the upload promise settle

  return { env, gaze, wizard, app, el, keys, nurse, clicks, uploads, alerts, original, me, PLAN,
           store: env.window.LumiStore, settings: current, frame, operate, runUntil, flush, visible,
           frames: (ms) => { for (let t = 0; t < ms; t += FRAME_MS) frame(); } };
}

module.exports = { setupWizard, DEFAULTS, WIDTH, HEIGHT };
