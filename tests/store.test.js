'use strict';
// AUDIT M8: writes (messages, symptoms, alerts) were fire-and-forget; if the
// server was unreachable they were silently lost, although the code claimed
// every write was mirrored to localStorage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/browser-env');

const OFFLINE = () => Promise.reject(new TypeError('Failed to fetch'));

function load({ storage } = {}) {
  const env = createEnv();
  if (storage) for (const [k, v] of Object.entries(storage)) env.localStorage.setItem(k, v);
  const sent = [];
  let reply = { status: 201 };
  env.fetch = OFFLINE;
  const online = () => {
    env.fetch = async (url, opts = {}) => {
      if (opts.method && opts.method !== 'GET') sent.push({ url, method: opts.method, body: JSON.parse(opts.body) });
      return { ok: reply.status < 400, status: reply.status, json: async () => ({}) };
    };
  };
  env.load('database.js');
  const store = env.get('LumiStore');
  const pending = () => JSON.parse(env.localStorage.getItem('lumiiq_pending_writes') || '[]');
  return { env, store, sent, pending, online, offline: () => { env.fetch = OFFLINE; },
           setReply: (status) => { reply = { status }; } };
}

test('an alert raised while the server is down is kept, then delivered with its original time', async () => {
  const s = load();
  s.store.addAlertLog('PROLONGED_CLOSURE', 'Eyes closed for 3.0s');
  await s.store.flushPending();
  assert.equal(s.pending().length, 1, 'kept in localStorage');
  const when = s.pending()[0].body.timestamp;
  s.online();
  await s.store.flushPending();
  assert.equal(s.pending().length, 0);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].url, '/api/logs/alert');
  assert.equal(s.sent[0].body.timestamp, when, 'event time preserved');
});

test('queued writes are delivered in the order they happened', async () => {
  const s = load();
  s.store.addTypedLog('first');
  s.store.addSymptomLog('Chest', 'pain');
  s.store.addTypedLog('third');
  await s.store.flushPending();
  s.online();
  await s.store.flushPending();
  assert.deepEqual(s.sent.map((w) => w.body.text || w.body.bodyPart), ['first', 'Chest', 'third']);
});

test('the queue survives a page reload', async () => {
  const first = load();
  first.store.addTypedLog('before reload');
  await first.store.flushPending();
  const second = load({ storage: { lumiiq_pending_writes: first.env.localStorage.getItem('lumiiq_pending_writes') } });
  second.online();
  await second.store.flushPending();
  assert.equal(second.sent[0].body.text, 'before reload');
});

test('a write the server rejects as invalid (4xx) is dropped, not retried forever', async () => {
  const s = load();
  s.online();
  s.setReply(400);
  s.store.addTypedLog('rejected');
  await s.store.flushPending();
  assert.equal(s.pending().length, 0);
});

test('a server error (5xx) keeps the write for a later retry', async () => {
  const s = load();
  s.online();
  s.setReply(500);
  s.store.addTypedLog('retry me');
  await s.store.flushPending();
  assert.equal(s.pending().length, 1);
});

test('only the latest settings are queued while offline', async () => {
  const s = load();
  s.store._cache.settings = { dwellTimeMs: 1200 };
  s.store.updateSetting('dwellTimeMs', 1500);
  s.env.clock.advance(300);                  // settings writes are debounced by 250 ms
  s.store.updateSetting('dwellTimeMs', 1800);
  s.env.clock.advance(300);
  await s.store.flushPending();
  const puts = s.pending().filter((w) => w.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.dwellTimeMs, 1800);
});

test('entries still waiting for the server are shown in the caregiver timeline', async () => {
  const s = load();
  s.store.addTypedLog('waiting');
  await s.store.flushPending();
  s.store._cache.typed = [];                 // e.g. after a reload
  await s.store.refreshLogs();
  assert.deepEqual(s.store.getTypedLogs().map((l) => l.text), ['waiting']);
});
