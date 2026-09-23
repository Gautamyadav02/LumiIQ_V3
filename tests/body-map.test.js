'use strict';
// AUDIT H5: overlapping body-map zones selected the wrong body part
// (the centres of Chest and Stomach selected "Back"; Head selected "Eyes").
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

function load() {
  const env = createEnv();
  env.window.LumiStore = { getSettings: () => ({ dwellTimeMs: 1200 }), addSymptomLog() {} };
  env.window.LumiVoice = { speak() {} };
  env.load('body-map.js');
  return { env, map: env.get('LumiBodyMap') };
}

const inside = (z, x, y) => ((x - z.cx) / z.rx) ** 2 + ((y - z.cy) / z.ry) ** 2 <= 1;

test('no two body-map zones overlap anywhere on the diagram', () => {
  const zones = load().map.PARTS.filter((p) => p.cx !== undefined);
  let overlaps = 0;
  for (let x = 0; x <= 400; x += 0.5) {
    for (let y = 0; y <= 450; y += 0.5) {
      if (zones.filter((z) => inside(z, x, y)).length > 1) overlaps += 1;
    }
  }
  assert.equal(overlaps, 0);
});

test('looking at the centre of a zone selects that zone', () => {
  const zones = load().map.PARTS.filter((p) => p.cx !== undefined);
  for (const z of zones) {
    const hits = zones.filter((q) => inside(q, z.cx, z.cy)).map((q) => q.id);
    assert.deepEqual([...hits], [z.id], `centre of ${z.id}`);   // copy out of the sandbox realm
  }
});

test('every body part can be selected, and "Back" is its own gaze button', () => {
  const { env, map } = load();
  const container = env.element({ id: 'bodymapScreen' });
  map.render('bodymapScreen');
  const html = container.innerHTML;
  for (const p of map.PARTS) assert.match(html, new RegExp(`data-part="${p.id}"`), p.id);
  assert.match(html, /<button[^>]*class="[^"]*\bgazeable\b[^"]*"[^>]*data-part="back"/);
  assert.doesNotMatch(html, /<ellipse[^>]*data-part="back"/, 'Back is not drawn over the front view');
});
