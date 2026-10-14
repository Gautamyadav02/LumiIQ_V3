#!/usr/bin/env node
/**
 * LumiIQ — evaluation report (Phase B)
 *
 *   npm run eval:report
 *
 * Reads every session in eval/sessions/, replays each one through the real
 * gaze modules (eval/replay.js) and writes eval/BASELINE.md with the
 * dissertation's Table 4.6 (accuracy and precision) and Table 4.7 (selection,
 * false activations, lag), plus what is needed to check them: the sessions
 * behind every row, the 95th-percentile error, and the in-app estimate beside
 * the measured error.
 *
 * Rules this script keeps:
 *   • Only numbers computed from recorded sessions appear. A figure that no
 *     session provides is printed as "—", never as an estimate or a zero.
 *   • Every row says where its numbers come from: "replayed real" (recomputed
 *     from the recording by replay) or "live real" (counted during the session).
 *   • A session marked `synthetic` is never a result. It is left out of
 *     BASELINE.md and can only appear in a separate file written with
 *     --synthetic, where every row is labelled "synthetic".
 *
 * Options:
 *   --sessions DIR   folder to read (default eval/sessions)
 *   --out FILE       file to write (default eval/BASELINE.md)
 *   --synthetic      pipeline check: simulate sessions (--count N, default 3)
 *                    and write eval/SYNTHETIC-CHECK.md instead. Not results.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Replay = require('./replay.js');
const { SessionRecorder } = require('./session-recorder.js');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const BASELINE_FILE = path.join(__dirname, 'BASELINE.md');
const SYNTHETIC_FILE = path.join(__dirname, 'SYNTHETIC-CHECK.md');
const MISSING = '—';

/** Read a folder of sessions; invalid files are reported, not counted. */
function loadSessions(dir) {
  const sessions = [], skipped = [];
  for (const file of Replay.findSessions(dir)) {
    try { sessions.push(Replay.loadSession(file)); }
    catch (err) { skipped.push({ file: path.basename(file), reason: err.message.replace(/^[^:]+: /, '') }); }
  }
  return { sessions, skipped };
}

// ── Formatting ───────────────────────────────────────────────────────

/** "mean ± SD unit", "value unit" for a single session, or "—". */
function stat(agg, digits, unit) {
  if (!agg || !agg.n) return null;
  const u = unit === '°' ? '°' : ` ${unit}`;
  return agg.n === 1 ? `${agg.mean.toFixed(digits)}${u}` : `${agg.mean.toFixed(digits)} ± ${agg.sd.toFixed(digits)}${u}`;
}

/** A length as "px / °". */
function length(results, pick) {
  const px = Replay.aggregate(results, (r) => { const m = pick(r); return m ? m.px : null; });
  const deg = Replay.aggregate(results, (r) => { const m = pick(r); return m ? m.deg : null; });
  if (!px.n) return { text: MISSING, n: 0, ids: [] };
  return { text: `${stat(px, 1, 'px')} / ${deg.n ? stat(deg, 2, '°') : 'no degrees'}`, n: px.n, ids: px.ids, mean: px.mean };
}

function value(results, pick, digits, unit, scale = 1) {
  const agg = Replay.aggregate(results, (r) => { const v = pick(r); return v == null ? null : v * scale; });
  return agg.n ? { text: stat(agg, digits, unit), n: agg.n, ids: agg.ids, mean: agg.mean } : { text: MISSING, n: 0, ids: [] };
}

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const count = (cells) => { const ns = [...new Set(cells.map((c) => c.n))]; return ns.length === 1 ? String(ns[0]) : cells.map((c) => c.n).join(' / '); };
const idsOf = (cells) => [...new Set(cells.flatMap((c) => c.ids))];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The Phase C improvements a session was recorded with, as text: none, C1–C7, or a list. */
function improvementsOn(session) {
  const flags = Replay.recordedFlags(session);
  const on = Object.keys(flags).filter((n) => flags[n]);
  return on.length === 0 ? 'none' : on.length === Object.keys(flags).length ? 'C1–C7' : on.join(', ');
}

// ── The report ───────────────────────────────────────────────────────

/**
 * @param {object[]} sessions            recorded sessions (format v2)
 * @param {object}   [o]
 * @param {string}   [o.generatedAt]     ISO time for the header
 * @param {boolean}  [o.synthetic]       pipeline check: use (and label) generated sessions
 * @param {Array}    [o.skipped]         [{file, reason}] files that could not be read
 * @param {string}   [o.code]            what produced the report (commit, branch)
 * @param {Function} [o.replay]          session → replay result (default Replay.replaySession)
 * @returns {string} markdown
 */
function buildReport(sessions, o = {}) {
  const synthetic = o.synthetic === true;
  const used = sessions.filter((s) => synthetic || s.synthetic !== true);
  const leftOut = sessions.length - used.length;
  const results = used.map((s) => (o.replay || Replay.replaySession)(s));
  const byId = new Map(used.map((s) => [s.id, s]));
  const replayed = synthetic ? 'synthetic' : 'replayed real';
  const live = synthetic ? 'synthetic' : 'live real';
  const source = (cells, label) => (cells.some((c) => c.n) ? label : MISSING);
  const rowsUsed = [];
  const note = (name, cells) => { rowsUsed.push([name, idsOf(cells).map((id) => `\`${id}\``).join(', ') || MISSING]); };
  const out = [];
  const p = (...lines) => out.push(...lines, '');

  // ── Header ──
  if (synthetic) {
    p('# LumiIQ — SYNTHETIC pipeline check', '',
      '> **These are not results.** Every number below comes from simulated sessions (a software "person" whose eyes',
      '> follow a simple rule). The file exists only to show that recording, replay and this report work end to end.',
      '> Real results are in `eval/BASELINE.md`, which is written only from sessions recorded with a person.');
  } else {
    p('# LumiIQ — evaluation baseline', '',
      'Written by `npm run eval:report` from the sessions in `eval/sessions/`. Do not edit by hand: run the command again.');
  }
  p(`*Generated ${o.generatedAt || new Date().toISOString()}${o.code ? ` · code: ${o.code}` : ''}*`);
  p('**How to read the numbers**',
    '- Every figure is computed by code from recorded sessions. A figure no session provides is shown as "—".',
    ...(synthetic
      ? ['- **synthetic**: every figure in this file. The sessions were simulated, not recorded with a person.']
      : ['- **replayed real**: recomputed from the recording by `eval/replay.js`, which runs the app\'s own gaze code.',
         '- **live real**: counted while the session ran (selections, false activations, lag).']),
    '- Lengths are given as pixels / degrees of visual angle. Mean ± SD is across sessions; *n* is the number of sessions.');

  // ── Sessions ──
  out.push('## Sessions', '');
  if (!used.length) {
    p('**No sessions have been recorded yet.** Every table below is therefore empty.',
      'To record one: open the app, go to **⚙ Caregiver → Diagnostics → Start an evaluation session**, and follow',
      '`docs/RECORDING.md`. Then run `npm run eval:report` again.');
  } else {
    const days = new Set(used.map((s) => String(s.createdAt).slice(0, 10)));
    const lighting = {};
    for (const s of used) { const l = (s.setup && s.setup.lighting) || 'not stated'; lighting[l] = (lighting[l] || 0) + 1; }
    p(`${plural(used.length, 'session')} on ${plural(days.size, 'day')}. Lighting: ${Object.entries(lighting).map(([k, v]) => `${k}: ${v}`).join(', ')}.`);
    if (used.length < 3) p('> Fewer than 3 sessions: the mean and SD below say little yet. The protocol asks for at least 3 per condition.');
    p(table(['Session', 'Recorded (UTC)', 'Lighting', 'Distance', 'Screen', 'Replay check', 'Improvements on'], used.map((s) => {
      const r = results.find((x) => x.id === s.id);
      const c = r.checks;
      const check = c.gazeFrames ? `model within ${c.rawMaxDiffPx.toFixed(2)} px, gaze within ${c.gazeMaxDiffPx.toFixed(1)} px of live` : 'no calibrated frames';
      return [`\`${s.id}\``, String(s.createdAt).slice(0, 16).replace('T', ' '), (s.setup && s.setup.lighting) || 'not stated',
              `${s.setup.distanceCm} cm`, `${s.setup.screenWidthCm} cm (${s.screen.width}×${s.screen.height} px)`, check,
              improvementsOn(s)];
    })));
    const improved = used.filter((s) => improvementsOn(s) !== 'none');
    if (improved.length) {
      p(`> **${plural(improved.length, 'session')} ${improved.length === 1 ? 'was' : 'were'} recorded with Phase C improvements on** (last column).`,
        '> The tables below describe the app as recorded, so they are not the Phase B baseline. The baseline is',
        '> recorded on branch `phase-b-eval`; `npm run eval:ablation` compares each improvement with it by replay.');
    }
  }
  if (leftOut) p(`> ${plural(leftOut, 'session')} marked synthetic ${leftOut === 1 ? 'was' : 'were'} left out: generated sessions are never results.`);
  if (o.skipped && o.skipped.length) {
    p('**Files that could not be used:**', ...o.skipped.map((s) => `- \`${s.file}\`: ${s.reason}`));
  }

  // ── Table A ──
  const val = (set, part) => (axis, kind) => (r) => r.analysis.validation[set][part][kind][axis];
  const head = (name) => (axis, kind) => (r) => r.analysis.head[name][kind][axis];
  const rowA = (name, pick) => {
    const cells = [length(results, pick('x', 'accuracy')), length(results, pick('y', 'accuracy')),
                   length(results, pick('x', 'precision')), length(results, pick('y', 'precision'))];
    note(`A: ${name}`, cells);
    return [name, ...cells.map((c) => c.text), count(cells), source(cells, replayed)];
  };
  const tableA = [
    rowA('Default settings, 9-point calibration', val('val9', 'standard')),
    rowA('Default settings, 16-point calibration', val('val16', 'standard')),
    rowA('Header and right-edge targets only', val('val9', 'headerRightEdge')),
    rowA('After head turn (about 5° left/right)', head('turn')),
    rowA('After head tilt (up/down)', head('tilt')),
    rowA('Leaning closer/farther', head('lean')),
  ];
  const inAppCells = [length(results, (r) => r.analysis.inApp.cal9 && r.analysis.inApp.cal9.x),
                      length(results, (r) => r.analysis.inApp.cal9 && r.analysis.inApp.cal9.y)];
  note('A: In-app estimate for the same calibration', inAppCells);
  const na = inAppCells[0].n ? 'n/a' : MISSING;
  tableA.push(['In-app estimate for the same calibration', inAppCells[0].text, inAppCells[1].text, na, na, count(inAppCells), source(inAppCells, replayed)]);
  p('## Table A — accuracy and precision (dissertation Table 4.6)', '',
    'Measured on targets that were **not** used for calibration, 500–1600 ms after each target appeared.',
    '',
    table(['Condition', 'Accuracy x', 'Accuracy y', 'Precision x', 'Precision y', 'n', 'Source'], tableA));
  p('- **Accuracy**: mean distance of the gaze from the target on that axis. **Precision**: spread (SD) of the gaze around its own mean.',
    '- Rows 1–2 use all 12 held-out targets; row 3 the 2 header and 2 right-edge targets; the head rows the 4 interior targets',
    '  measured again after each movement, with the 9-point calibration.',
    '- The in-app estimate is what the calibration screen reports (leave-one-target-out error). The app does not estimate precision.');

  // ── Table B ──
  const sel = (mode, key) => (r) => r.analysis.selection[mode][key];
  const rowB = (name, dwell, blink) => { note(`B: ${name}`, [dwell, blink]); return [name, dwell.text, blink.text, count([dwell, blink]), source([dwell, blink], live)]; };
  p('## Table B — selection and false activations (dissertation Table 4.7)', '',
    table(['Measure', 'Dwell', 'Blink', 'n', 'Source'], [
      rowB('Wrong selections (%)', value(results, sel('dwell', 'wrongPct'), 1, '%'), value(results, sel('blink', 'wrongPct'), 1, '%')),
      rowB('Missed prompts (%)', value(results, sel('dwell', 'missedPct'), 1, '%'), value(results, sel('blink', 'missedPct'), 1, '%')),
      rowB('Time per correct selection (s)', value(results, sel('dwell', 'timeMs'), 2, 's', 0.001), value(results, sel('blink', 'timeMs'), 2, 's', 0.001)),
      rowB('False activations per minute (rest period)', value(results, (r) => r.analysis.rest.dwellPerMin, 2, 'per min'),
           value(results, (r) => r.analysis.rest.blinkPerMin, 2, 'per min')),
    ]));
  p('- Selection test: 10 prompted keys per mode on the real keyboard. **Wrong**: share of selections that hit another target.',
    '  **Missed**: share of prompts not selected within 10 s. Time runs from the prompt to the correct selection.',
    '- False activations: selections made during the 2-minute rest period, with the default "dwell or blink" mode, split by what caused each one.');

  // ── Lag and jitter ──
  const lag = (level, key) => (r) => { const l = r.analysis.lag[level]; return l ? (key === 'jitter' ? l.jitter.px : l.settlingMs) : null; };
  const rowL = (name, a, b) => { note(`Lag: ${name}`, [a, b]); return [name, a.text, b.text, count([a, b]), source([a, b], live)]; };
  p('### Lag and jitter', '',
    table(['Measure', 'Smoothing 0.35', 'Smoothing 0.06', 'n', 'Source'], [
      rowL('Settling time (ms)', value(results, lag('0.35', 'settling'), 0, 'ms'), value(results, lag('0.06', 'settling'), 0, 'ms')),
      rowL('Fixation jitter (px, RMS)', value(results, lag('0.35', 'jitter'), 1, 'px'), value(results, lag('0.06', 'jitter'), 1, 'px')),
    ]));
  p('- **Settling time**: from a target jumping until the cursor stays within 60 px of where it comes to rest. It includes the',
    '  person\'s own reaction time. **Jitter**: RMS movement of the cursor between frames during a steady 5-second fixation.');

  // ── p95 and target size ──
  const p95cells = ['val9', 'val16'].map((set) => length(results, (r) => r.analysis.validation[set].standard.p95));
  const smallest = (cell) => (cell.n ? `${(2 * cell.mean).toFixed(0)} px` : MISSING);
  p95cells.forEach((c, i) => note(`p95: ${i ? '16' : '9'}-point`, [c]));
  p('## 95th-percentile error and the smallest reliable target', '',
    table(['Calibration', '95th-percentile error', 'Smallest reliable target', 'n', 'Source'], [
      ['9-point', p95cells[0].text, smallest(p95cells[0]), String(p95cells[0].n), source([p95cells[0]], replayed)],
      ['16-point', p95cells[1].text, smallest(p95cells[1]), String(p95cells[1].n), source([p95cells[1]], replayed)],
    ]));
  const keys = used.map((s) => s.layouts && s.layouts.keyboard).find(Boolean);
  const lines = ['A target is reliable only if 95% of gaze samples aimed at its centre land inside it, so it must be at least',
                 '**twice the 95th-percentile error** wide and high.'];
  if (keys && p95cells[0].n) {
    const min = 2 * p95cells[0].mean;
    const small = keys.filter((k) => k.w < min || k.h < min);
    lines.push(`In the recorded keyboard screen, ${small.length} of ${keys.length} gaze targets are smaller than this ` +
               `(${min.toFixed(0)} px, from the 9-point figure) in width or height.`);
  }
  p(...lines);

  // ── M1 ──
  const m1 = (cv, part, axis) => (r) => (r.m1.cal9 && r.m1.cal9[cv] ? r.m1.cal9[cv][part][axis] : null);
  const rowM = (name, cv, part) => {
    const cells = [length(results, m1(cv, part, 'x')), length(results, m1(cv, part, 'y'))];
    note(`M1: ${name}`, cells);
    return [name, cells[0].text, cells[1].text, count(cells), source(cells, replayed)];
  };
  p('## In-app estimate against the held-out error (audit finding M1)', '',
    'For the 9-point calibration: what the calibration screen would have reported, next to what was measured.', '',
    table(['Figure', 'x', 'y', 'n', 'Source'], [
      rowM('In-app estimate, interleaved folds (old)', 'interleaved', 'inApp'),
      rowM('In-app estimate, leave-one-target-out (new)', 'loto', 'inApp'),
      rowM('Measured on the 12 held-out targets', 'loto', 'heldOut'),
    ]));

  // ── Settle time (L6) ──
  const rowS = (name, part) => {
    const cells = [length(results, val('val9', part)('x', 'accuracy')), length(results, val('val9', part)('y', 'accuracy'))];
    note(`L6: ${name}`, cells);
    return [name, cells[0].text, cells[1].text, count(cells), source(cells, replayed)];
  };
  p('## Settle time before measuring (audit finding L6)', '',
    'The same showing of each target, measured over two windows (9-point calibration, accuracy).', '',
    table(['Window after the target appears', 'Accuracy x', 'Accuracy y', 'n', 'Source'], [
      rowS('500–1600 ms (the calibration timing)', 'standard'),
      rowS('1100–2200 ms (longer settle)', 'longSettle'),
    ]));

  // ── Head positions reached ──
  const poseRows = [];
  for (const [id, key, unit, scale] of [['turnLeft', 'yaw', '°', 1], ['turnRight', 'yaw', '°', 1], ['tiltUp', 'pitch', '°', 1],
                                        ['tiltDown', 'pitch', '°', 1], ['leanCloser', 'scale', '%', 100], ['leanFarther', 'scale', '%', 100]]) {
    const cell = value(results, (r) => {
      const e = (byId.get(r.id).events || []).filter((x) => x.name === 'pose' && x.data && x.data.id === id).pop();
      return e && e.data[key] != null ? e.data[key] : null;
    }, 1, unit, scale);
    poseRows.push([id, cell.text, String(cell.n), source([cell], live)]);
  }
  p('## Head positions actually reached', '',
    'Change from the head position during the head-still accuracy check, as measured by the camera when each position was accepted.',
    'Turn and tilt in degrees; lean as the change in apparent face size.', '',
    table(['Position', 'Change', 'n', 'Source'], poseRows));

  // ── Sessions behind each row ──
  p('## Sessions behind each row', '', table(['Row', 'Sessions'], rowsUsed));
  return out.join('\n').replace(/\n+$/, '\n');
}

// ── Command line ─────────────────────────────────────────────────────

function codeVersion() {
  try {
    const { execFileSync } = require('child_process');
    const git = (...args) => execFileSync('git', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = git('status', '--porcelain', '--untracked-files=no') ? ', with uncommitted changes' : '';
    return `commit ${git('rev-parse', '--short', 'HEAD')} on ${git('rev-parse', '--abbrev-ref', 'HEAD')}${dirty}`;
  } catch (err) {
    return null;
  }
}

/** Simulated sessions for the pipeline check: the real wizard driven by a software "person". */
async function simulateSessions(n) {
  const { setupWizard } = require('../tests/helpers/wizard');
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const w = setupWizard({ person: { seed: i + 1 } });
    w.el.evalStartBtn.click();
    if (!w.runUntil('summary')) throw new Error('the simulated session did not finish');
    await w.flush();
    sessions.push({ ...JSON.parse(JSON.stringify(w.uploads[0].session)), id: `SYNTHETIC-session-${i + 1}`, synthetic: true });
  }
  return sessions;
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const synthetic = argv.includes('--synthetic');
  const outFile = arg('--out') || (synthetic ? SYNTHETIC_FILE : BASELINE_FILE);
  let sessions, skipped = [];
  if (synthetic) {
    sessions = await simulateSessions(parseInt(arg('--count') || '3', 10));
  } else {
    ({ sessions, skipped } = loadSessions(arg('--sessions') || SESSIONS_DIR));
  }
  const real = sessions.filter((s) => synthetic || s.synthetic !== true);
  fs.writeFileSync(outFile, buildReport(sessions, { synthetic, skipped, code: codeVersion() }), 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), outFile)} from ${real.length} session${real.length === 1 ? '' : 's'}` +
              (synthetic ? ' (SYNTHETIC: not results)' : '') +
              (skipped.length ? `; ${skipped.length} file(s) skipped` : '') + '.');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
}

module.exports = { buildReport, loadSessions, simulateSessions, codeVersion, BASELINE_FILE, SYNTHETIC_FILE, SESSIONS_DIR };
