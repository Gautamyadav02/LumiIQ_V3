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
    'gaze-engine.js', 'keyboard.js', 'body-map.js', 'phrases.js', 'app.js',
  ]);
});

test('every script loads in order and defines its global', () => {
  const env = createEnv();
  env.load(...scriptsFromIndexHtml());
  const globals = ['LumiStore', 'LumiDictionary', 'LumiVoice', 'OneEuroFilter', 'RidgeRegressor',
    'GazeStabilizer', 'DwellController', 'GazeCalibration', 'DriftDetector', 'LumiGaze',
    'LumiKeyboard', 'LumiBodyMap', 'LumiPhrases', 'EyeApp'];
  for (const name of globals) {
    assert.notEqual(env.get(`typeof ${name}`), 'undefined', `${name} should be defined`);
  }
});
