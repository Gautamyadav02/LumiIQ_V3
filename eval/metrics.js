/**
 * LumiIQ — evaluation metrics (Phase B)
 *
 * Pure functions that turn recorded gaze samples and selection events into the
 * figures the evaluation reports. They run in the browser (the wizard's summary)
 * and under Node (eval/replay.js, eval/report.js).
 *
 * Rules these functions keep:
 *   • No data means no number. An empty input gives null, never 0.
 *   • Nothing is rounded here. Rounding is for display only.
 *   • Lengths come in pixels and, when the viewing geometry is known, in
 *     degrees of visual angle. Without the geometry, degrees are null.
 *
 * Definitions (for one fixation on one target):
 *   accuracy   mean distance of the gaze samples from the target
 *              (x and y: mean absolute offset on that axis; bias: signed mean)
 *   precision  RMS distance of the samples from their own mean
 *              (x and y: standard deviation on that axis)
 *   p95        the 95th percentile of the distance from the target
 */
(function (root) {
  'use strict';

  // ── Geometry ───────────────────────────────────────────────────────

  /**
   * The viewing geometry needed for degrees, or null if any part is missing.
   * @param {{distanceCm:number, screenWidthCm:number, screenWidthPx:number}} g
   */
  function geometry(g) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!g || !ok(g.distanceCm) || !ok(g.screenWidthCm) || !ok(g.screenWidthPx)) return null;
    return { distanceCm: g.distanceCm, cmPerPx: g.screenWidthCm / g.screenWidthPx };
  }

  /** A length on the screen (px) as the angle it covers at the eye, in degrees. */
  function pxToDeg(px, geom) {
    if (!geom || px == null || !Number.isFinite(px)) return null;
    return Math.atan((Math.abs(px) * geom.cmPerPx) / geom.distanceCm) * 180 / Math.PI;
  }

  const both = (px, geom) => ({ px, deg: pxToDeg(px, geom) });
  const none = () => ({ px: null, deg: null });

  // ── Helpers ────────────────────────────────────────────────────────

  const mean = (values) => values.reduce((a, v) => a + v, 0) / values.length;

  /** Nearest-rank percentile (p in 0..1); null for an empty list. */
  function percentile(values, p) {
    if (!values || !values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }

  /** Mean and sample standard deviation (n − 1) of the values that are numbers. */
  function meanSd(values) {
    const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
    if (!v.length) return { n: 0, mean: null, sd: null };
    const m = mean(v);
    if (v.length < 2) return { n: 1, mean: m, sd: null };
    return { n: v.length, mean: m, sd: Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) };
  }

  // ── Accuracy, precision, 95th percentile ───────────────────────────

  /** @param {Array<{x:number,y:number}>} samples gaze points (px)  @param {{x,y}} target (px) */
  function accuracy(samples, target, geom) {
    const n = samples ? samples.length : 0;
    if (!n) return { n: 0, ...none(), x: none(), y: none(), biasX: none(), biasY: none() };
    const dx = samples.map((s) => s.x - target.x);
    const dy = samples.map((s) => s.y - target.y);
    const signed = (px) => ({ px, deg: px == null ? null : Math.sign(px) * pxToDeg(px, geom) });
    return {
      n,
      ...both(mean(dx.map((v, i) => Math.hypot(v, dy[i]))), geom),
      x: both(mean(dx.map(Math.abs)), geom),
      y: both(mean(dy.map(Math.abs)), geom),
      biasX: geom ? signed(mean(dx)) : { px: mean(dx), deg: null },
      biasY: geom ? signed(mean(dy)) : { px: mean(dy), deg: null },
    };
  }

  /** RMS spread of the samples around their own mean. Needs at least two samples. */
  function precision(samples, geom) {
    const n = samples ? samples.length : 0;
    if (n < 2) return { n, ...none(), x: none(), y: none() };
    const mx = mean(samples.map((s) => s.x));
    const my = mean(samples.map((s) => s.y));
    const vx = mean(samples.map((s) => (s.x - mx) ** 2));
    const vy = mean(samples.map((s) => (s.y - my) ** 2));
    return { n, ...both(Math.sqrt(vx + vy), geom), x: both(Math.sqrt(vx), geom), y: both(Math.sqrt(vy), geom) };
  }

  /** The 95th percentile of the distance from the target. */
  function p95(samples, target, geom) {
    const n = samples ? samples.length : 0;
    if (!n) return { n: 0, ...none() };
    return { n, ...both(percentile(samples.map((s) => Math.hypot(s.x - target.x, s.y - target.y)), 0.95), geom) };
  }

  // ── Selection test ─────────────────────────────────────────────────
  // A trial is one prompted target: { outcome: 'correct' | 'missed', timeMs,
  // selections: [{ label, correct }] }. A trial ends at the first correct
  // selection or at the time limit; wrong selections before that are counted.

  /** Selections that hit a target other than the prompted one. */
  function wrongSelections(trials) {
    return (trials || []).reduce((a, t) => a + (t.selections || []).filter((s) => !s.correct).length, 0);
  }

  /** Prompts that timed out without the prompted target being selected. */
  function missedSelections(trials) {
    return (trials || []).filter((t) => t.outcome === 'missed').length;
  }

  /** Mean time (ms) from the prompt to the correct selection; null if none was correct. */
  function timePerCorrectSelection(trials) {
    const times = (trials || []).filter((t) => t.outcome === 'correct' && typeof t.timeMs === 'number').map((t) => t.timeMs);
    return times.length ? mean(times) : null;
  }

  function selectionSummary(trials) {
    const list = trials || [];
    const wrong = wrongSelections(list);
    const missed = missedSelections(list);
    const correct = list.filter((t) => t.outcome === 'correct').length;
    const selections = wrong + correct;
    return {
      trials: list.length, selections, correct, wrong, missed,
      wrongPct: selections ? (wrong / selections) * 100 : null,   // share of selections that hit another target
      missedPct: list.length ? (missed / list.length) * 100 : null, // share of prompts that timed out
      timeMs: timePerCorrectSelection(list),
    };
  }

  /** Unintended activations per minute of a rest period; null without a duration. */
  function falseActivationsPerMin(count, durationMs) {
    if (!(durationMs > 0) || count == null) return null;
    return count / (durationMs / 60000);
  }

  // ── Lag and jitter ─────────────────────────────────────────────────

  /**
   * Time (ms) from the target's appearance until the gaze is inside the zone
   * (within radiusPx of `center`) and stays inside for holdMs.
   * @param {Array<{t:number,x:number,y:number}>} samples  t in ms from target onset
   * @returns {number|null} null if it never settled
   */
  function settlingTime(samples, center, radiusPx, holdMs = 300) {
    if (!samples || !samples.length) return null;
    const inside = samples.map((s) => Math.hypot(s.x - center.x, s.y - center.y) <= radiusPx);
    for (let i = 0; i < samples.length; i++) {
      if (!inside[i]) continue;
      let held = false;
      let j = i;
      for (; j < samples.length && inside[j]; j++) {
        if (samples[j].t - samples[i].t >= holdMs) { held = true; break; }
      }
      if (held) return samples[i].t;
      i = j;   // left the zone before holdMs: continue after the exit
    }
    return null;
  }

  /** RMS of the movement between consecutive samples during a steady fixation. */
  function fixationJitter(samples, geom) {
    const steps = [];
    for (let i = 1; i < (samples ? samples.length : 0); i++) {
      steps.push(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    }
    if (!steps.length) return { n: 0, ...none() };
    return { n: steps.length, ...both(Math.sqrt(mean(steps.map((d) => d * d))), geom) };
  }

  // ── Session analysis ───────────────────────────────────────────────
  // The functions below read a recorded session (eval/session-recorder.js,
  // format v2). The wizard's on-screen summary and the offline replay both use
  // them, so a "live" and a "replayed" figure are computed in exactly one way.
  // `gaze` is one {x, y} (px) or null per frame; by default the smoothed gaze
  // that was recorded live, but a replay passes its own.

  // Windows after a target appears (ms). "standard" is the calibration timing:
  // 500 ms for the eye to land, then 1,100 ms. "longSettle" waits 1,100 ms first
  // (AUDIT L6). Both are cut from the same 2,200 ms showing of each target.
  const WINDOWS = { standard: [500, 1600], longSettle: [1100, 2200] };
  const FIXATION_SKIP_MS = 1000;   // the first second of a fixation is the eye arriving
  const STEADY_TAIL_MS = 700;      // a jump's resting position = mean of its last 700 ms
  const SETTLE_RADIUS_PX = 60;     // "settled" = within this of the resting position…
  const SETTLE_HOLD_MS = 300;      // …and staying there this long

  /** The recorded smoothed gaze of every frame. */
  function recordedGaze(session) {
    const ix = session.frameFields.indexOf('gazeX'), iy = session.frameFields.indexOf('gazeY');
    return session.frames.map((f) => (f[ix] == null || f[iy] == null ? null : { x: f[ix], y: f[iy] }));
  }

  function sessionGeometry(session) {
    const setup = session.setup || {}, screen = session.screen || {};
    return geometry({ distanceCm: setup.distanceCm, screenWidthCm: setup.screenWidthCm, screenWidthPx: screen.width });
  }

  /** Gaze samples of one shown target inside [from, to) ms after it appeared: [{t, x, y}]. */
  function targetSamples(session, target, window, gaze) {
    const g = gaze || recordedGaze(session);
    const it = session.frameFields.indexOf('t');
    const out = [];
    const end = target.frame1 == null ? session.frames.length : target.frame1;
    for (let i = target.frame0; i < end; i++) {
      const t = session.frames[i][it] - target.t0;
      if (t >= window[0] && t < window[1] && g[i]) out.push({ t, x: g[i].x, y: g[i].y });
    }
    return out;
  }

  const emptyValidation = () => ({
    targets: 0, samples: 0, accuracy: { ...none(), x: none(), y: none() },
    precision: { ...none(), x: none(), y: none() }, p95: none(), perTarget: [],
  });

  /**
   * Accuracy, precision and p95 over a set of shown targets.
   * @param {object} filter  { set?, sets?, groups?, poses? }: which targets to include
   * @param {number[]} window  [from, to) ms after each target appeared
   * Accuracy and precision are worked out per target and then averaged over the
   * targets; p95 is taken over all the samples' errors together.
   */
  function validationSummary(session, filter, window, gaze) {
    const geom = sessionGeometry(session);
    const screen = session.screen || {};
    const g = gaze || recordedGaze(session);
    const sets = filter.sets || (filter.set ? [filter.set] : null);
    const perTarget = [];
    const errors = [];
    for (const target of session.targets || []) {
      if (sets && !sets.includes(target.set)) continue;
      if (filter.groups && !filter.groups.includes(target.group)) continue;
      if (filter.poses && !filter.poses.includes(target.pose)) continue;
      const samples = targetSamples(session, target, window, g);
      if (samples.length < 2) continue;                       // nothing usable for this target
      const at = { x: target.x * screen.width, y: target.y * screen.height };
      perTarget.push({ id: target.id, group: target.group, set: target.set, pose: target.pose || null,
                       n: samples.length, accuracy: accuracy(samples, at, geom), precision: precision(samples, geom) });
      for (const p of samples) errors.push(Math.hypot(p.x - at.x, p.y - at.y));
    }
    if (!perTarget.length) return emptyValidation();
    const avg = (pick) => {
      const px = meanSd(perTarget.map((t) => pick(t).px)).mean;
      const deg = meanSd(perTarget.map((t) => pick(t).deg)).mean;
      return { px, deg };
    };
    return {
      targets: perTarget.length,
      samples: errors.length,
      accuracy: { ...avg((t) => t.accuracy), x: avg((t) => t.accuracy.x), y: avg((t) => t.accuracy.y) },
      precision: { ...avg((t) => t.precision), x: avg((t) => t.precision.x), y: avg((t) => t.precision.y) },
      p95: both(percentile(errors, 0.95), geom),
      perTarget,
    };
  }

  /** Fixation jitter and settling time measured at one smoothing level. */
  function lagSummary(session, smoothing, gaze) {
    const geom = sessionGeometry(session);
    const g = gaze || recordedGaze(session);
    const of = (phase) => (session.targets || []).filter((t) => t.phase === phase && t.smoothing === smoothing);
    const fix = of('fixation')[0];
    const steady = fix ? targetSamples(session, fix, [FIXATION_SKIP_MS, Infinity], g) : [];
    const times = [];
    const jumps = of('jumps');
    for (const jump of jumps) {
      const all = targetSamples(session, jump, [0, Infinity], g);
      if (!all.length) continue;
      const last = all[all.length - 1].t;
      const tail = all.filter((p) => p.t >= last - STEADY_TAIL_MS);
      const rest = { x: mean(tail.map((p) => p.x)), y: mean(tail.map((p) => p.y)) };
      const t = settlingTime(all, rest, SETTLE_RADIUS_PX, SETTLE_HOLD_MS);
      if (t != null) times.push(t);
    }
    return {
      smoothing,
      jitter: fixationJitter(steady, geom),
      precision: precision(steady, geom),
      jumps: jumps.length,
      settled: times.length,
      settlingMs: times.length ? mean(times) : null,
      radiusPx: SETTLE_RADIUS_PX,
    };
  }

  /** A calibration quality report as an estimate per axis, in px and degrees. */
  function inAppFromReport(report, points, geom) {
    if (!report || !report.ok) return null;
    const or = (v) => (v != null ? v : null);
    return { method: report.cvMethod || null, rating: report.rating || null, points,
             x: both(or(report.rmseXPx), geom), y: both(or(report.rmseYPx), geom), combined: both(or(report.accuracyPx), geom) };
  }

  /** The app's own estimate for a calibration, as recorded in the session. */
  function inAppEstimate(session, name) {
    const cal = (session.calibrations || []).filter((c) => c.name === name && c.report && c.report.ok).pop();
    return cal ? inAppFromReport(cal.report, cal.points, sessionGeometry(session)) : null;
  }

  /** False activations in the rest period: all of them, and split by what caused them. */
  function restSummary(rest) {
    if (!rest) return { mode: null, durationMs: null, count: null, perMin: null, dwellPerMin: null, blinkPerMin: null };
    const acts = rest.activations || [];
    const rate = (n) => falseActivationsPerMin(n, rest.durationMs);
    return {
      mode: rest.mode || null, durationMs: rest.durationMs, count: acts.length, perMin: rate(acts.length),
      dwellPerMin: rate(acts.filter((a) => a.by === 'dwell').length),
      blinkPerMin: rate(acts.filter((a) => a.by === 'blink').length),
    };
  }

  /**
   * Everything one session measured.
   * @param {object} [o]  { gaze }: a replayed gaze track instead of the recorded one
   */
  function analyseSession(session, o = {}) {
    const g = o.gaze || recordedGaze(session);
    const validation = {};
    for (const set of ['val9', 'val16']) {
      validation[set] = {
        standard: validationSummary(session, { set }, WINDOWS.standard, g),
        longSettle: validationSummary(session, { set }, WINDOWS.longSettle, g),
        headerRightEdge: validationSummary(session, { set, groups: ['header', 'rightEdge'] }, WINDOWS.standard, g),
        interior: validationSummary(session, { set, groups: ['interior'] }, WINDOWS.standard, g),
        corner: validationSummary(session, { set, groups: ['corner'] }, WINDOWS.standard, g),
      };
    }
    const head = {};
    for (const [name, poses] of [['turn', ['turnLeft', 'turnRight']], ['tilt', ['tiltUp', 'tiltDown']], ['lean', ['leanCloser', 'leanFarther']]]) {
      head[name] = validationSummary(session, { poses }, WINDOWS.standard, g);
    }
    const trials = session.selections || [];
    const rest = session.rest;
    const levels = Array.from(new Set((session.targets || []).filter((t) => t.smoothing != null).map((t) => t.smoothing)));
    const lag = {};
    for (const level of levels) lag[String(level)] = lagSummary(session, level, g);
    return {
      id: session.id,
      geometry: sessionGeometry(session),
      validation, head,
      inApp: { cal9: inAppEstimate(session, 'cal9'), cal16: inAppEstimate(session, 'cal16') },
      selection: {
        dwell: selectionSummary(trials.filter((t) => t.mode === 'dwell')),
        blink: selectionSummary(trials.filter((t) => t.mode === 'blink')),
      },
      rest: restSummary(rest),
      lag,
    };
  }

  const api = {
    geometry, pxToDeg, percentile, meanSd,
    accuracy, precision, p95,
    wrongSelections, missedSelections, timePerCorrectSelection, selectionSummary, falseActivationsPerMin,
    settlingTime, fixationJitter,
    WINDOWS, recordedGaze, sessionGeometry, targetSamples, validationSummary, lagSummary,
    inAppFromReport, inAppEstimate, analyseSession,
  };
  root.LumiMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
