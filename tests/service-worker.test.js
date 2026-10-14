'use strict';
// AUDIT M12: the service worker answered cache-first and never revalidated,
// so after a code change browsers kept running the old JavaScript (a risk
// for evaluation recordings), and it did not cache MediaPipe's WebAssembly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./helpers/browser-env');

const ORIGIN = 'http://localhost:8000';

function loadWorker() {
  const handlers = {};
  const store = new Map();                                  // cache name -> Map(path -> body)
  const key = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN).pathname;
  const response = (body, ok = true) => ({ ok, status: ok ? 200 : 500, body, clone() { return response(body, ok); } });
  let network = (url) => Promise.resolve(response(`network:${new URL(url, ORIGIN).pathname}`));
  const inits = [];                                         // the options of each network fetch
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        async addAll(urls) { for (const u of urls) entries.set(key(u), `precached:${u}`); },
        async put(req, res) { entries.set(key(req), res.body); },
      };
    },
    async match(req) {
      for (const entries of store.values()) if (entries.has(key(req))) return response(entries.get(key(req)));
      return undefined;
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
  const self = {
    location: { origin: ORIGIN },
    clients: { claim() {} },
    skipWaiting() {},
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  const context = vm.createContext({
    self, caches, URL, Promise, console,
    fetch: (req, init) => { inits.push(init); return network(typeof req === 'string' ? req : req.url); },
    Response: { error: () => ({ ok: false, status: 0, body: 'network-error' }) },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), context, { filename: 'sw.js' });

  async function install() {
    let done; handlers.install({ waitUntil: (p) => { done = p; } }); await done;
  }
  async function request(url, method = 'GET') {
    let answer = null;
    handlers.fetch({ request: { url: new URL(url, ORIGIN).href, method }, respondWith: (p) => { answer = p; } });
    return answer === null ? null : (await answer).body;     // null: left to the browser (not intercepted)
  }
  return { install, request, store, inits, setNetwork: (fn) => { network = fn; }, handlers };
}

test('MediaPipe WebAssembly is precached, so tracking can start without the server', async () => {
  const sw = loadWorker();
  await sw.install();
  const cached = [...sw.store.values()][0];
  for (const f of ['/lib/mediapipe/wasm/vision_wasm_internal.js', '/lib/mediapipe/wasm/vision_wasm_internal.wasm',
                   '/models/face_landmarker.task', '/gaze-engine.js']) {
    assert.ok(cached.has(f), f);
  }
});

test('when the server is reachable, the current file is served (not a stale cached copy)', async () => {
  const sw = loadWorker();
  await sw.install();
  assert.equal(await sw.request('/app.js'), 'network:/app.js');
});

test('when the server is unreachable, the cached copy is served', async () => {
  const sw = loadWorker();
  await sw.install();
  sw.setNetwork(() => Promise.reject(new TypeError('offline')));
  assert.equal(await sw.request('/app.js'), 'precached:/app.js');
});

test('a fresh network copy replaces the cached one', async () => {
  const sw = loadWorker();
  await sw.install();
  await sw.request('/app.js');                               // online: cache updated
  await new Promise((r) => setImmediate(r));
  sw.setNetwork(() => Promise.reject(new TypeError('offline')));
  assert.equal(await sw.request('/app.js'), 'network:/app.js');
});

test('API requests and writes are never answered from the cache', async () => {
  const sw = loadWorker();
  await sw.install();
  assert.equal(await sw.request('/api/logs'), null);
  assert.equal(await sw.request('/api/logs/typed', 'POST'), null);
});

test('old caches are deleted when a new version activates', async () => {
  const sw = loadWorker();
  sw.store.set('lumiiq-v3', new Map([['/app.js', 'old']]));
  await sw.install();
  let done; sw.handlers.activate({ waitUntil: (p) => { done = p; } }); await done;
  assert.equal(sw.store.has('lumiiq-v3'), false);
});

test("the network fetch bypasses the browser's HTTP cache guess, so files cached before a change are not reused", async () => {
  // Files served before the server sent Cache-Control were judged "fresh" by Chrome, and the worker's
  // plain fetch() returned them without asking the server: old JavaScript ran after a change.
  const w = loadWorker();
  await w.request('/voice.js');
  assert.equal(w.inits.at(-1)?.cache, 'no-cache');
});
