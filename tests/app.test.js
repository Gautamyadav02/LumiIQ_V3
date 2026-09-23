'use strict';
// app.js regressions: AUDIT H4 (SVG body zones could not be activated by gaze),
// H7 (log text rendered as HTML), L4 (status pill wrong / alerts overwritten).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, GAZE_MODULES } = require('./helpers/browser-env');

function setupApp({ logs = {} } = {}) {
  const env = createEnv();
  env.window.LumiStore = {
    getSettings: () => ({ dwellTimeMs: 1200, smoothingFactor: 0.35, activeEye: 'both', earThreshold: 0.18 }),
    addAlertLog() {},
    getTypedLogs: () => logs.typed || [],
    getSymptomLogs: () => logs.symptom || [],
    getAlertLogs: () => logs.alert || [],
  };
  for (const id of ['gazeCursor', 'statusDot', 'statusText', 'emergencyOverlay', 'emergencyDesc',
                    'dashCommLogs', 'dashAlertLogs']) env.element({ id });
  env.load(...GAZE_MODULES, 'gaze-engine.js', 'app.js');
  env.get('LumiGaze')._buildSubsystems();
  return { env, app: env.get('EyeApp'), pill: () => env.document.getElementById('statusText').textContent };
}

// ── H4 ──────────────────────────────────────────────────────────────
test('H4: a dwell on an SVG body zone (which has no click()) still activates it', () => {
  const { env, app } = setupApp();
  const zone = env.element({ tag: 'ellipse', classes: ['body-zone', 'gazeable'], svg: true });
  let clicks = 0;
  zone.addEventListener('click', () => { clicks += 1; });
  assert.equal(typeof zone.click, 'undefined', 'like a real SVG element');
  app._onDwellClick(zone);
  assert.equal(clicks, 1);
});

test('H4: HTML targets are still activated through their own click()', () => {
  const { env, app } = setupApp();
  const key = env.element({ tag: 'button', classes: ['key-btn', 'gazeable'] });
  let clicks = 0;
  key.addEventListener('click', () => { clicks += 1; });
  app._onDwellClick(key);
  assert.equal(clicks, 1);
});

// ── H7 ──────────────────────────────────────────────────────────────
test('H7: log text is shown as text, never interpreted as HTML', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const when = '2026-09-23T10:00:00Z';
  const { env, app } = setupApp({ logs: {
    typed: [{ text: evil, timestamp: when }],
    symptom: [{ bodyPart: evil, symptom: evil, timestamp: when }],
    alert: [{ type: evil, details: evil, timestamp: when }],
  } });
  app._refreshLogs();
  for (const id of ['dashCommLogs', 'dashAlertLogs']) {
    const html = env.document.getElementById(id).innerHTML;
    assert.doesNotMatch(html, /<img/, `${id} must not contain live markup`);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, `${id} shows the text escaped`);
  }
});

// ── L4 ──────────────────────────────────────────────────────────────
test('L4: the status pill names the actual reason there is no gaze', () => {
  const { app, pill } = setupApp();
  const cases = [['Face not detected', /no face/i], ['Eyes closed', /eyes closed/i],
                 ['low_confidence', /low confidence/i], ['calibrating', /calibrating/i]];
  for (const [state, expected] of cases) {
    app._onGazeUpdate(null, null, 'none', state, 0);
    assert.match(pill(), expected, `state ${state}`);
  }
});

test('L4: an emergency message is not overwritten by the next gaze frame', () => {
  const { app, pill } = setupApp();
  app._onEmergency('PROLONGED_CLOSURE', 'Eyes closed for 3.0s');
  app._onGazeUpdate(100, 100, 'both', 'active', 1);
  assert.match(pill(), /EMERGENCY/);
});
