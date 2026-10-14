'use strict';
// Loads every script exactly as index.html does and checks each defines its
// global. Catches syntax errors and load-order mistakes in all app files
// (the older gaze/_smoke.js only covers the engine and app.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv, ROOT } = require('./helpers/browser-env');

function scriptsFromIndexHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

test('index.html loads the scripts this test expects, in this order', () => {
  assert.deepEqual(scriptsFromIndexHtml(), [
    'database.js', 'dictionary.js', 'voice.js',
    'gaze/one-euro-filter.js', 'gaze/ridge-regression.js', 'gaze/gaze-stabilizer.js',
    'gaze/dwell-controller.js', 'gaze/gaze-calibration.js', 'gaze/drift-detector.js',
    'gaze-engine.js', 'keyboard.js', 'body-map.js', 'phrases.js', 'diagnostics.js',
    'eval/metrics.js', 'eval/session-recorder.js', 'eval/eval-wizard.js', 'app.js',
  ]);
});

test('every script loads in order and defines its global', () => {
  const env = createEnv();
  env.load(...scriptsFromIndexHtml());
  const globals = ['LumiStore', 'LumiDictionary', 'LumiVoice', 'OneEuroFilter', 'RidgeRegressor',
    'GazeStabilizer', 'DwellController', 'GazeCalibration', 'DriftDetector', 'LumiGaze',
    'LumiKeyboard', 'LumiBodyMap', 'LumiPhrases', 'LumiDiagnostics',
    'LumiMetrics', 'LumiSessionRecorder', 'LumiEvalWizard', 'EyeApp'];
  for (const name of globals) {
    assert.notEqual(env.get(`typeof ${name}`), 'undefined', `${name} should be defined`);
  }
});

test('every script index.html loads is precached by the service worker and served by server.py', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server.py'), 'utf8');
  const staticFiles = server.match(/STATIC_FILES = \{([\s\S]*?)\}/)[1];
  for (const src of scriptsFromIndexHtml()) {
    assert.ok(sw.includes(`'/${src}'`), `sw.js ASSETS should list /${src}`);
    const inDir = /^(gaze|eval)\//.test(src) && server.includes(`"/${src.split('/')[0]}/": {".js"}`);
    assert.ok(inDir || staticFiles.includes(`"/${src}"`), `server.py should serve /${src}`);
  }
});
