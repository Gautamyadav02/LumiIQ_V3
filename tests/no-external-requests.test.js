'use strict';
// AUDIT L9 / L10: no third-party network requests from the app, and no
// downloads with certificate checks disabled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/browser-env');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('L9: the stylesheet and page load nothing from other sites', () => {
  assert.doesNotMatch(read('styles.css'), /@import\s+url\(\s*['"]?https?:/i);
  assert.doesNotMatch(read('index.html'), /\b(?:src|href)\s*=\s*["']https?:/i);
});

test('L10: dlib_tracker.py keeps TLS certificate verification on', () => {
  const src = read('dlib_tracker.py');
  assert.doesNotMatch(src, /CERT_NONE|check_hostname\s*=\s*False/);
  assert.doesNotMatch(src, /["']http:\/\//);
});
