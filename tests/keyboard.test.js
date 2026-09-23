'use strict';
// AUDIT H6: autocorrect on SPACE silently replaced words ("CANT" -> "Want",
// "DONT" -> "Door", "OK" -> "Or"), so some words could not be typed at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

function load() {
  const env = createEnv();
  env.window.LumiStore = { addTypedLog() {}, addAlertLog() {} };
  env.window.LumiVoice = { speak() {} };
  env.load('dictionary.js', 'keyboard.js');
  const kb = env.get('LumiKeyboard');
  kb.currentText = '';
  const type = (word) => { for (const ch of word) kb._handleKey(ch); kb._handleKey('SPACE'); };
  return { env, kb, dict: env.get('LumiDictionary'), type };
}

test('SPACE never changes the word the user typed', () => {
  const { kb, type } = load();
  const words = ['CANT', 'DONT', 'HOME', 'LOVE', 'SICK', 'OK', 'TV', 'KIDS', 'JOHN', 'ANNA', 'WIFI', 'NEEDS'];
  for (const w of words) type(w);
  assert.equal(kb.currentText, words.join(' ') + ' ');
});

test('a likely correction is offered as a suggestion, not applied', () => {
  const { dict } = load();
  // "WATR" is one edit from "water" and no other word is as close.
  assert.equal(dict.getPredictions('I WATR')[0], 'Water');
});

test('choosing the suggested correction replaces the word', () => {
  const { kb } = load();
  for (const ch of 'WATR') kb._handleKey(ch);
  kb._selectSuggestion('Water');
  assert.equal(kb.currentText, 'Water ');
});

test('common contractions typed without an apostrophe are known words', () => {
  const { dict } = load();
  for (const w of ['cant', 'dont', 'wont', 'im', 'ok']) assert.equal(dict.getCorrection(w), null, w);
});
