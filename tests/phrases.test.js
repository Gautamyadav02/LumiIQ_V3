'use strict';
// AUDIT M9: phrases were only spoken — "Call nurse" / "I can't breathe" raised
// no alert and nothing was logged, so a caregiver out of earshot never knew.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

function load() {
  const env = createEnv();
  const spoken = [];
  const logged = [];
  env.window.LumiVoice = { speak: (t) => spoken.push(t) };
  env.window.LumiStore = { addTypedLog: (t) => logged.push(t) };
  env.load('phrases.js');
  const alerts = [];
  env.window.addEventListener('eye_emergency_alert', (e) => alerts.push(e.detail));
  return { env, phrases: env.get('LumiPhrases'), spoken, logged, alerts };
}

test('an urgent phrase is spoken, logged and raises a caregiver alert', () => {
  const s = load();
  s.phrases.say('Call nurse', true);
  assert.deepEqual([...s.spoken], ['Call nurse']);
  assert.deepEqual([...s.logged], ['Call nurse']);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].type, 'URGENT_PHRASE');
  assert.match(s.alerts[0].details, /Call nurse/);
});

test('an everyday phrase is spoken and logged without an alarm', () => {
  const s = load();
  s.phrases.say('Thank you', false);
  assert.deepEqual([...s.logged], ['Thank you']);
  assert.equal(s.alerts.length, 0);
});

test('only the Urgent category is marked as urgent on screen', () => {
  const s = load();
  const box = s.env.element({ id: 'phrasesScreen' });
  s.phrases.render('phrasesScreen');
  for (const p of s.phrases.categories.Urgent) {
    assert.match(box.innerHTML, new RegExp(`data-text="${p}" data-urgent="true"`), p);
  }
  assert.match(box.innerHTML, /data-text="Thank you" data-urgent="false"/);
});
