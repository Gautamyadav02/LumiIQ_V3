/**
 * LumiIQ — evaluation session recorder (Phase B)
 *
 * Collects what one run of the evaluation wizard measured, so it can be saved
 * as one JSON file in eval/sessions/ and replayed offline (eval/replay.js).
 *
 * PRIVACY — what a session can contain:
 *   • numbers only: timestamps, the 10 gaze features, EAR, head pose, confidence,
 *     the model's predictions, 16 face landmarks (GazeFeatures.RECORD_INDICES)
 *     and the head matrix per frame;
 *   • the targets shown, selection events, settings and the calibration model;
 *   • short labels (key names, lighting).
 * It can NOT contain video, camera images or audio: frame() copies a fixed list
 * of numeric fields and nothing else, and validate() rejects long or
 * image-like text anywhere in a session.
 *
 * Nothing is recorded until start() is given consent: true.
 */
(function (root) {
  'use strict';

  const FORMAT = 'lumiiq-eval-session';
  const VERSION = 2;
  const MAX_TEXT = 300;   // no text field in a session is longer than this

  const Features = root.GazeFeatures ||
    (typeof require !== 'undefined' ? require('../gaze/gaze-features.js') : null);

  const REASONS = ['no_face', 'eyes_closed', 'low_confidence', 'calibrating', 'uncalibrated', 'ok'];
  const EYE_MODES = ['none', 'left', 'right', 'both'];
  const FRAME_FIELDS = [
    't', 'face', 'reason', 'eyeMode', 'conf',
    'earR', 'earL', 'openR', 'openL', 'usedR', 'usedL',
    'yaw', 'pitch', 'roll',
    'f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9',
    'predX', 'predY', 'gazeX', 'gazeY', 'cal',
  ];

  /** Round to `d` decimals; anything that is not a finite number becomes null. */
  function r(v, d) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const k = 10 ** d;
    return Math.round(v * k) / k;
  }
  const flag = (v) => (v ? 1 : 0);
  const copy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  class SessionRecorder {
    /**
     * @param {object}   [o]
     * @param {Function} [o.now]      monotonic clock in ms (default performance.now)
     * @param {Function} [o.wallNow]  wall clock as a Date (default new Date())
     * @param {Function} [o.random]   0..1, for the id suffix
     */
    constructor({ now, wallNow, random } = {}) {
      this._now = now || (() => performance.now());
      this._wallNow = wallNow || (() => new Date());
      this._random = random || Math.random;
      this.recording = false;
      this.session = null;
    }

    /**
     * Begin a session. Throws unless consent is exactly `true`.
     * @param {{consent:boolean, setup:object, screen:object, settings:object, settingsBefore?:object, flags?:object,
     *          camera?:{width:number,height:number}}} o  camera: the picture's size in pixels
     */
    start({ consent, setup, screen, settings, settingsBefore, flags, synthetic, camera } = {}) {
      if (consent !== true) throw new Error('Recording needs the participant\'s explicit consent.');
      const at = this._wallNow();
      const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
      const suffix = Math.floor(this._random() * 36 ** 4).toString(36).padStart(4, '0');
      this.session = {
        format: FORMAT, version: VERSION,
        id: `${stamp}-${suffix}`,
        createdAt: at.toISOString(), finishedAt: null,
        consent: { given: true, at: at.toISOString() },
        // true only for generated sessions (tests, pipeline checks). Reports never count those as results.
        synthetic: synthetic === true,
        setup: copy(setup) || {},
        screen: copy(screen) || {},
        // Landmarks are normalised by the picture's width and height; its aspect ratio
        // is needed to turn them back into true proportions.
        camera: camera && camera.width > 0 && camera.height > 0 ? { width: camera.width, height: camera.height } : null,
        engine: { featureDim: Features.FEATURE_DIM, landmarkIndices: Features.RECORD_INDICES.slice(), flags: copy(flags) || {} },
        settingsBefore: copy(settingsBefore), settings: copy(settings),
        enums: { reason: REASONS.slice(), eyeMode: EYE_MODES.slice() },
        frameFields: FRAME_FIELDS.slice(),
        frames: [], landmarks: [], matrices: [],
        phases: [], targets: [], calibrations: [], layouts: {},
        selections: [], rest: null, events: [], summary: null,
      };
      this._phase = null;
      this._target = null;
      this._cal = null;
      this._calFrames = [];
      this.recording = true;
      return this.session.id;
    }

    // ── Frames ───────────────────────────────────────────────────────

    /** Append one engine frame record (LumiGaze.onFrameInfo). Returns false if not recording. */
    frame(info) {
      if (!this.recording || !info) return false;
      const s = this.session;
      const eye = (side) => (info.eyes || []).find((e) => e.side === side) || {};
      const R = eye('right'), L = eye('left');
      const pose = info.pose || {};
      const f = info.features || [];
      const index = s.frames.length;
      s.frames.push([
        r(info.t, 2), flag(info.face), REASONS.indexOf(info.reason), EYE_MODES.indexOf(info.eyeMode || 'none'), r(info.confidence, 4),
        r(R.ear, 5), r(L.ear, 5), flag(R.open), flag(L.open), flag(R.used), flag(L.used),
        r(pose.yaw, 3), r(pose.pitch, 3), r(pose.roll, 3),
        // Features, landmarks and the head matrix keep enough decimals for a replay to
        // reproduce the live prediction to about a thousandth of a pixel.
        r(f[0], 8), r(f[1], 8), r(f[2], 8), r(f[3], 8), r(f[4], 8), r(f[5], 8), r(f[6], 8), r(f[7], 8), r(f[8], 8), r(f[9], 8),
        r(info.pred && info.pred.x, 2), r(info.pred && info.pred.y, 2),
        r(info.gaze && info.gaze.x, 2), r(info.gaze && info.gaze.y, 2),
        flag(info.calSample),
      ]);
      s.landmarks.push(Array.isArray(info.lm) ? info.lm.map((v) => r(v, 7)) : null);
      s.matrices.push(Array.isArray(info.matrix) ? info.matrix.map((v) => r(v, 7)) : null);
      if (info.calSample && this._cal) this._calFrames.push(index);
      return true;
    }

    // ── Phases and targets ───────────────────────────────────────────

    /** Start a named phase (ends the previous phase and any target on show). */
    setPhase(name, meta = {}) {
      if (!this.recording) return;
      this.endPhase();
      // Extra data first: it can never overwrite the phase's own name, times or frame range.
      this._phase = { ...copy(meta), name, t0: r(this._now(), 2), t1: null, frame0: this.session.frames.length, frame1: null };
      this.session.phases.push(this._phase);
    }

    endPhase() {
      this.hideTarget();
      if (!this._phase) return;
      this._phase.t1 = r(this._now(), 2);
      this._phase.frame1 = this.session.frames.length;
      this._phase = null;
    }

    /** A target appears at normalised screen coordinates (0..1). Ends the previous target. */
    showTarget({ id, group, x, y, ...meta }) {
      if (!this.recording) return;
      this.hideTarget();
      this._target = {
        ...copy(meta), phase: this._phase ? this._phase.name : null, id, group: group || null, x, y,
        t0: r(this._now(), 2), t1: null, frame0: this.session.frames.length, frame1: null,
      };
      this.session.targets.push(this._target);
    }

    hideTarget() {
      if (!this._target) return;
      this._target.t1 = r(this._now(), 2);
      this._target.frame1 = this.session.frames.length;
      this._target = null;
    }

    // ── Calibration ──────────────────────────────────────────────────

    calibrationStart(name, points) {
      if (!this.recording) return;
      this._cal = { name, points, t0: r(this._now(), 2), t1: null, targets: [], report: null, model: null };
      this._calFrames = [];
      this.session.calibrations.push(this._cal);
    }

    /** The app discarded the samples gathered so far for the current point. */
    calibrationClear() { this._calFrames = []; }

    /** A point was committed: remember the frames that were in its buffer, and when (t: the next target appears then). */
    calibrationPoint({ index, target, samples, accepted, rejected }) {
      if (!this._cal) return;
      this._cal.targets.push({ index, x: target.x, y: target.y, frames: this._calFrames.slice(), samples, accepted, rejected,
                               t: r(this._now(), 2) });
      this._calFrames = [];
    }

    calibrationEnd({ report, model } = {}) {
      if (!this._cal) return;
      this._cal.t1 = r(this._now(), 2);
      this._cal.report = copy(report);
      this._cal.model = copy(model);
      this._cal = null;
      this._calFrames = [];
    }

    // ── Events ───────────────────────────────────────────────────────

    /** The on-screen rectangles of the gaze targets during a test (labels and px). */
    layout(name, rects) {
      if (!this.recording) return;
      this.session.layouts[name] = (rects || []).map((b) => ({ label: String(b.label).slice(0, 40), x: r(b.x, 2), y: r(b.y, 2), w: r(b.w, 2), h: r(b.h, 2) }));
    }

    selectionTrial(trial) { if (this.recording) this.session.selections.push(copy(trial)); }

    restResult(result) { if (this.recording) this.session.rest = copy(result); }

    note(name, data) {
      if (this.recording) this.session.events.push({ t: r(this._now(), 2), name, data: copy(data) || null });
    }

    /** End the session and return it as plain JSON-ready data. */
    finish(summary) {
      if (!this.recording) return this.session;
      this.endPhase();
      this.session.finishedAt = this._wallNow().toISOString();
      this.session.summary = copy(summary) || null;
      this.recording = false;
      return this.session;
    }

    // ── Checking and saving ──────────────────────────────────────────

    /** The problems that make a session unusable or unsafe to keep ([] if none). */
    static validate(s) {
      const problems = [];
      if (!s || typeof s !== 'object' || Array.isArray(s)) return ['a session must be an object'];
      if (s.format !== FORMAT) problems.push(`format must be "${FORMAT}"`);
      if (s.version !== VERSION) problems.push(`version must be ${VERSION}`);
      if (typeof s.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(s.id)) problems.push('id must be 8-64 letters, digits, "-" or "_"');
      if (!s.consent || s.consent.given !== true) problems.push('consent was not given');
      if (!Array.isArray(s.frameFields) || !Array.isArray(s.frames)) problems.push('frames are missing');
      else {
        const width = s.frameFields.length;
        const badRow = s.frames.findIndex((f) => !Array.isArray(f) || f.length !== width ||
                                                  !f.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))));
        if (badRow !== -1) problems.push(`frame ${badRow} is not a row of ${width} numbers`);
      }
      for (const key of ['landmarks', 'matrices']) {
        if (!Array.isArray(s[key])) { problems.push(`${key} are missing`); continue; }
        const bad = s[key].findIndex((v) => v !== null && !(Array.isArray(v) && v.every((n) => n === null || typeof n === 'number')));
        if (bad !== -1) problems.push(`${key}[${bad}] is not a list of numbers`);
      }
      // Defence in depth: no long or image-like text anywhere (the big numeric arrays are checked above).
      const scan = (value, where) => {
        if (typeof value === 'string') {
          if (value.length > MAX_TEXT) problems.push(`text at ${where} is longer than ${MAX_TEXT} characters`);
          else if (/^data:|;base64,/i.test(value)) problems.push(`text at ${where} looks like an image or file`);
        } else if (Array.isArray(value)) {
          value.forEach((v, i) => { if (v !== null && typeof v !== 'number') scan(v, `${where}[${i}]`); });
        } else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) scan(v, `${where}.${k}`);
        }
      };
      for (const [k, v] of Object.entries(s)) {
        if (k !== 'frames' && k !== 'landmarks' && k !== 'matrices') scan(v, k);
      }
      return problems;
    }

    /** Node only: write a session to `dir` as <id>.json. Never overwrites. Returns the path. */
    static writeToDir(session, dir) {
      const problems = SessionRecorder.validate(session);
      if (problems.length) throw new Error('Session not saved: ' + problems.join('; '));
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${session.id}.json`);
      if (fs.existsSync(file)) throw new Error(`Session not saved: ${file} already exists`);
      fs.writeFileSync(file, JSON.stringify(session), 'utf8');
      return file;
    }

    /** Browser: save through the local server into eval/sessions/. Resolves to { ok, file | error }. */
    static async upload(session, fetchFn) {
      const doFetch = fetchFn || fetch;
      try {
        const res = await doFetch('/api/eval/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session),
        });
        const body = await res.json().catch(() => ({}));
        return res.ok ? { ok: true, file: body.file } : { ok: false, error: body.error || `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: 'the local server could not be reached' };
      }
    }

    /** Browser: offer the session as a file download (fallback when upload fails). */
    static download(session, doc) {
      const d = doc || document;
      const url = URL.createObjectURL(new Blob([JSON.stringify(session)], { type: 'application/json' }));
      const a = d.createElement('a');
      a.href = url;
      a.download = `${session.id}.json`;
      d.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  SessionRecorder.FORMAT = FORMAT;
  SessionRecorder.VERSION = VERSION;
  SessionRecorder.FRAME_FIELDS = FRAME_FIELDS;
  SessionRecorder.REASONS = REASONS;
  SessionRecorder.EYE_MODES = EYE_MODES;

  root.LumiSessionRecorder = SessionRecorder;
  if (typeof module !== 'undefined' && module.exports) module.exports = { SessionRecorder };
})(typeof window !== 'undefined' ? window : globalThis);
