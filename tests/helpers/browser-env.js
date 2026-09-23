'use strict';
/**
 * A small stand-in for the browser, so the app's real script files can be
 * loaded into a Node `vm` context and unit-tested without a browser.
 *
 * Only what the tests need is implemented: a controllable clock and timers,
 * window/document events, simple fake elements, localStorage and fetch.
 * It is deliberately not a DOM implementation — each test builds the few
 * elements it needs with `env.element(...)`.
 *
 * Note: objects created inside the context (arrays, plain objects) come from
 * a different JavaScript realm, so compare them with assert.deepEqual (loose)
 * or JSON, not assert.deepStrictEqual.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

/** Controllable time: performance.now(), timers and requestAnimationFrame all run on it. */
class FakeClock {
  constructor() { this.now = 0; this._timers = []; this._nextId = 1; }
  setTimeout(fn, ms) { return this._add(fn, ms, 0); }
  setInterval(fn, ms) { return this._add(fn, ms, Math.max(1, ms || 0)); }
  clear(id) { this._timers = this._timers.filter((t) => t.id !== id); }
  _add(fn, ms, every) {
    const id = this._nextId++;
    this._timers.push({ id, at: this.now + Math.max(0, ms || 0), fn, every });
    return id;
  }
  /** Move time forward by `ms`, firing every timer that falls due, in order. */
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      let next = null;
      for (const t of this._timers) if (t.at <= end && (!next || t.at < next.at)) next = t;
      if (!next) break;
      this.now = next.at;
      if (next.every) next.at += next.every; else this.clear(next.id);
      next.fn();
    }
    this.now = end;
  }
}

class FakeClassList {
  constructor(list) { this._set = new Set(list); }
  add(...names) { names.forEach((n) => this._set.add(n)); }
  remove(...names) { names.forEach((n) => this._set.delete(n)); }
  contains(name) { return this._set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : Boolean(force);
    if (on) this._set.add(name); else this._set.delete(name);
    return on;
  }
}

/** Matches the simple selectors the app uses: `.cls`, `#id`, `tag`, `tag.cls`. */
function matches(el, selector) {
  const m = /^([a-z]*)(?:#([\w-]+))?((?:\.[\w-]+)*)$/i.exec(selector.trim());
  if (!m) throw new Error(`browser-env: unsupported selector "${selector}"`);
  const [, tag, id, classes] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.id !== id) return false;
  return classes.split('.').filter(Boolean).every((c) => el.classList.contains(c));
}

/** Silent stand-in for Web Audio (the siren), so alarm code runs without sound. */
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  resume() { return Promise.resolve(); }
  createOscillator() { return { connect() {}, start() {}, stop() {}, type: '', frequency: { setValueAtTime() {} } }; }
  createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}

class MouseEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clientX = init.clientX || 0;
    this.clientY = init.clientY || 0;
  }
}

function createEnv({ width = 1440, height = 900 } = {}) {
  const clock = new FakeClock();
  const registry = [];

  class FakeElement extends EventTarget {
    constructor({ id = '', tag = 'div', classes = [], parent = null, rect = null, svg = false, dataset = {} } = {}) {
      super();
      this.id = id;
      this.tagName = tag.toUpperCase();
      this.classList = new FakeClassList(classes);
      this.dataset = { ...dataset };
      this.style = {};
      this.children = [];
      this.parentElement = null;
      this.textContent = '';
      this.innerHTML = '';
      this.value = '';
      this.isConnected = true;
      this._rect = rect || { left: 0, top: 0, width: 0, height: 0 };
      // HTMLElement.click() exists; SVG elements have no click() method.
      if (!svg) this.click = () => this.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (parent) parent.appendChild(this);
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() { this.isConnected = false; }
    closest(selector) {
      for (let el = this; el; el = el.parentElement) if (matches(el, selector)) return el;
      return null;
    }
    querySelector(selector) {
      for (const c of this.children) {
        if (matches(c, selector)) return c;
        const deep = c.querySelector(selector);
        if (deep) return deep;
      }
      return null;
    }
    querySelectorAll(selector) {
      const out = [];
      for (const c of this.children) {
        if (matches(c, selector)) out.push(c);
        out.push(...c.querySelectorAll(selector));
      }
      return out;
    }
    getBoundingClientRect() {
      const r = this._rect;
      return { left: r.left, top: r.top, width: r.width, height: r.height,
               right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
    }
  }

  const documentEvents = new EventTarget();
  const body = new FakeElement({ tag: 'body' });
  const document = {
    hidden: false,
    visibilityState: 'visible',
    body,
    getElementById: (id) => registry.find((el) => el.id === id) || null,
    querySelector: (sel) => registry.find((el) => matches(el, sel)) || null,
    querySelectorAll: (sel) => registry.filter((el) => matches(el, sel)),
    createElement: (tag) => new FakeElement({ tag }),
    elementFromPoint: (x, y) => env.hit(x, y),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    clear: () => storage.clear(),
  };

  const windowEvents = new EventTarget();
  const sandbox = {
    console,
    document,
    localStorage,
    navigator: { mediaDevices: {}, onLine: true, userAgent: 'browser-env' },
    performance: { now: () => clock.now },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clear(id),
    setInterval: (fn, ms) => clock.setInterval(fn, ms),
    clearInterval: (id) => clock.clear(id),
    requestAnimationFrame: (fn) => clock.setTimeout(() => fn(clock.now), 16),
    cancelAnimationFrame: (id) => clock.clear(id),
    fetch: (...args) => env.fetch(...args),
    Event,
    EventTarget,
    CustomEvent,
    MouseEvent,
    AudioContext: FakeAudioContext,
    HTMLVideoElement: function HTMLVideoElement() {},
    innerWidth: width,
    innerHeight: height,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);

  const env = {
    context,
    clock,
    document,
    window: sandbox,
    localStorage,
    /** What document.elementFromPoint returns; tests replace this. */
    hit: () => null,
    /** Network stub; by default the server is unreachable. */
    fetch: () => Promise.reject(new TypeError('Failed to fetch (browser-env: offline)')),
    /** Create a fake element; pass `id` to make it findable via getElementById/querySelector. */
    element(opts = {}) {
      const el = new FakeElement(opts);
      registry.push(el);
      return el;
    },
    /** Run repository files in the context, like <script> tags in index.html. */
    load(...files) {
      for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
      return env;
    },
    /** Read a global (including top-level `const` bindings such as LumiGaze). */
    get(expression) { return vm.runInContext(expression, context); },
  };
  return env;
}

/** The gaze modules in the order index.html loads them. */
const GAZE_MODULES = [
  'gaze/one-euro-filter.js',
  'gaze/ridge-regression.js',
  'gaze/gaze-stabilizer.js',
  'gaze/dwell-controller.js',
  'gaze/gaze-calibration.js',
  'gaze/drift-detector.js',
];

module.exports = { createEnv, FakeClock, GAZE_MODULES, ROOT };
