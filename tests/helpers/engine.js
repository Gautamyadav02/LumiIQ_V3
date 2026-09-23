'use strict';
/**
 * Loads the real gaze engine (gaze/*.js + gaze-engine.js) into a fake browser
 * with a stub LumiStore, and helpers to feed it synthetic camera frames.
 */
const { createEnv, GAZE_MODULES } = require('./browser-env');
const { faceLandmarks, FACING_CAMERA } = require('./landmarks');

const DEFAULT_SETTINGS = {
  dwellTimeMs: 1200, smoothingFactor: 0.35, activeEye: 'both', earThreshold: 0.18,
  swapEyes: false, faceLostAlarmSec: 10,
};

/**
 * @param {object}  [o]
 * @param {boolean} [o.calibrated=true]  install a stub model that always predicts the screen centre
 * @param {object}  [o.settings]         overrides for the stub settings
 */
function setupEngine({ calibrated = true, settings = {} } = {}) {
  const env = createEnv();
  const alerts = [];
  env.window.LumiStore = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    getSettings() { return this.settings; },
    addAlertLog(type, details) { alerts.push({ type, details }); },
    getCalibration() { return null; },
    saveCalibration(c) { this.saved = c; },
  };
  env.load(...GAZE_MODULES, 'gaze-engine.js');
  const gaze = env.get('LumiGaze');
  gaze._buildSubsystems();
  if (calibrated) {
    gaze.isCalibrated = true;
    gaze.calibration = { isReady: true, predict: () => ({ x: 0.5, y: 0.5 }) };
  }
  // One dwell target covering the screen centre (where the stub model looks).
  const key = env.element({ id: 'key', tag: 'button', classes: ['key-btn', 'gazeable'],
                            rect: { left: 650, top: 380, width: 140, height: 140 } });
  env.hit = () => key;
  const fired = [];
  const progress = [];
  gaze.onDwellClick = (el) => fired.push({ el, t: env.clock.now });
  gaze.onDwellProgress = (el, p) => progress.push({ p, t: env.clock.now });
  return { env, gaze, key, fired, progress, alerts, store: env.window.LumiStore };
}

/** Feed `ms` of frames (every `step` ms) with the given eye state. */
function feedFrames({ env, gaze }, ms, eyes = {}, step = 33) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    env.clock.advance(step);
    gaze._processLandmarks(faceLandmarks(eyes), FACING_CAMERA);
  }
}

const EYES_OPEN = { openL: 0.3, openR: 0.3 };
const EYES_CLOSED = { openL: 0.05, openR: 0.05 };

module.exports = { setupEngine, feedFrames, EYES_OPEN, EYES_CLOSED, DEFAULT_SETTINGS };
