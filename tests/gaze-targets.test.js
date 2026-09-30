'use strict';
// AUDIT C2: gaze may only activate elements explicitly marked `.gazeable`.
// Before the fix any <button> (e.g. the alarm's "CAREGIVER CONFIRMED" or
// "Stop Gaze Camera") could be pressed by gaze.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/browser-env');
const { setupEngine } = require('./helpers/engine');

function hitAt(ctx, el) {
  ctx.env.hit = () => el;
  ctx.env.clock.advance(60);                 // _hitTest caches its result for 50 ms
  return ctx.gaze._hitTest(0, 0);
}

test('hit-test returns a .gazeable element', () => {
  const ctx = setupEngine();
  const key = ctx.env.element({ tag: 'button', classes: ['key-btn', 'gazeable'] });
  assert.equal(hitAt(ctx, key), key);
});

test('hit-test finds the .gazeable ancestor of an inner element', () => {
  const ctx = setupEngine();
  const key = ctx.env.element({ tag: 'button', classes: ['gazeable'] });
  const label = ctx.env.element({ tag: 'span', parent: key });
  assert.equal(hitAt(ctx, label), key);
});

test('hit-test ignores buttons and links that are not .gazeable', () => {
  const ctx = setupEngine();
  const dismiss = ctx.env.element({ id: 'alarmDismissBtn', tag: 'button', classes: ['alarm-dismiss-btn'] });
  const link = ctx.env.element({ tag: 'a' });
  assert.equal(hitAt(ctx, dismiss), null);
  assert.equal(hitAt(ctx, link), null);
});

test('caregiver-only controls in index.html are not gaze targets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const id of ['alarmDismissBtn', 'startCameraBtn', 'startCalibrationBtn', 'tabDashboard',
                    'acceptCalibBtn', 'recalibBtn', 'exitCalibBtn', 'startCalibProgressBtn', 'sleepModeBtn',
                    'resetSettingsBtn']) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} should exist in index.html`);
    assert.doesNotMatch(tag[0], /\bgazeable\b/, `${id} must not be .gazeable`);
  }
});
