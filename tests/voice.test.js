'use strict';
// AUDIT H8: TTS preferred online voices ("Google …", "… Natural"), which fail
// silently without internet and send the patient's words to a cloud service;
// speech errors were never reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

const VOICES = [
  { name: 'Google US English', lang: 'en-US', localService: false },
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Daniel', lang: 'en-GB', localService: true },
  { name: 'Google हिन्दी', lang: 'hi-IN', localService: false },
  { name: 'Lekha', lang: 'hi-IN', localService: true },
];

function load({ voices = VOICES, withSpeech = true } = {}) {
  const env = createEnv();
  const spoken = [];
  if (withSpeech) {
    env.window.speechSynthesis = {
      paused: false, onvoiceschanged: null,
      getVoices: () => voices, cancel() {}, resume() {},
      speak(u) { spoken.push(u); },
    };
    env.window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }
  env.window.LumiStore = { getSettings: () => ({ voiceLanguage: 'en-US' }) };
  env.load('voice.js');
  const voice = env.get('LumiVoice');
  const errors = [];
  voice.onError = (text, reason) => errors.push({ text, reason });
  return { voice, spoken, errors };
}

test('an on-device voice is chosen over an online voice of the same language', () => {
  const { voice } = load();
  assert.equal(voice._pickVoice('en-US').name, 'Samantha');
  assert.equal(voice._pickVoice('en-GB').name, 'Daniel');
  assert.equal(voice._pickVoice('hi-IN').name, 'Lekha');
});

test('a higher-quality on-device voice is preferred when there is one', () => {
  const { voice } = load({ voices: [...VOICES, { name: 'Ava (Enhanced)', lang: 'en-US', localService: true }] });
  assert.equal(voice._pickVoice('en-US').name, 'Ava (Enhanced)');
});

test('an online voice is used only when no on-device voice exists', () => {
  const { voice } = load({ voices: [{ name: 'Google US English', lang: 'en-US', localService: false }] });
  assert.equal(voice._pickVoice('en-US').name, 'Google US English');
});

test('a speech error is reported instead of failing silently', () => {
  const { voice, spoken, errors } = load();
  voice.speak('I need water');
  spoken[0].onerror({ error: 'network' });
  assert.deepEqual(JSON.parse(JSON.stringify(errors)), [{ text: 'I need water', reason: 'network' }]);
});

test('a message cut short by a newer one is not reported as an error', () => {
  const { voice, spoken, errors } = load();
  voice.speak('first');
  spoken[0].onerror({ error: 'interrupted' });
  assert.equal(errors.length, 0);
});

test('a browser without speech synthesis reports it', () => {
  const { voice, errors } = load({ withSpeech: false });
  voice.speak('hello');
  assert.equal(errors.length, 1);
});
