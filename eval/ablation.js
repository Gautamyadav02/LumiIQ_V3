#!/usr/bin/env node
/**
 * LumiIQ — Phase C comparison: each improvement against the baseline (C8)
 *
 * Replays every recorded session (eval/replay.js, the app's own gaze code)
 * with the baseline (all Phase C improvements off), with each improvement
 * alone, and with all seven, and writes eval/IMPROVEMENTS.md.
 *
 * Which sessions are held out, which figures count and what "meets the
 * criteria" means were fixed before any session was recorded:
 * docs/adr/0003-phase-c-ablation.md. In short:
 *   - held-out = the sessions of the last recording day (UTC); the rest are development;
 *   - an improvement meets the criteria if, on the held-out mean, it is 15 % more
 *     accurate, or has a lower p95, or fewer wrong selections, AND is not worse in
 *     false activations or time per correct selection.
 *
 * Usage:
 *   npm run eval:ablation                       → eval/IMPROVEMENTS.md
 *   node eval/ablation.js --sessions <dir> --out <file>
 *   node eval/ablation.js --synthetic [--count 3]   pipeline check with simulated
 *       sessions → eval/SYNTHETIC-ABLATION.md (gitignored; every number "synthetic")
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Features = require('../gaze/gaze-features.js');
const Replay = require('./replay.js');
const Report = require('./report.js');

const OUT_FILE = path.join(__dirname, 'IMPROVEMENTS.md');
const SYNTHETIC_FILE = path.join(__dirname, 'SYNTHETIC-ABLATION.md');
const MISSING = '—';

const VARIANTS = [
  { id: 'baseline', label: 'Baseline (Phase B): all off', improvements: 'none' },
  { id: 'C1', label: 'C1: head-pose compensation', improvements: ['C1'] },
  { id: 'C2', label: 'C2: eye-opening floor for gaze', improvements: ['C2'] },
  { id: 'C3', label: 'C3: stricter outlier filter', improvements: ['C3'] },
  { id: 'C4', label: 'C4: 300 ms settle guard', improvements: ['C4'] },
  { id: 'C5', label: 'C5: degree 1 or 2', improvements: ['C5'] },
  { id: 'C6', label: 'C6: confidence-weighted smoothing', improvements: ['C6'] },
  { id: 'C7', label: 'C7: directional drift detector', improvements: ['C7'] },
  { id: 'all', label: 'All of C1–C7', improvements: 'all' },
];

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

/** The figures of ADR 0003, per session (null when the session does not give one). */
const FIGURES = [
  { key: 'accuracy9', title: 'Accuracy, 9-point (px)', digits: 1, pick: (r) => r.analysis.validation.val9.standard.accuracy.px },
  { key: 'accuracy16', title: 'Accuracy, 16-point (px)', digits: 1, pick: (r) => r.analysis.validation.val16.standard.accuracy.px },
  { key: 'p95', title: 'p95, 9-point (px)', digits: 1, pick: (r) => r.analysis.validation.val9.standard.p95.px },
  { key: 'head', title: 'After head movement (px)', digits: 1, pick: (r) => {
    const v = ['turn', 'tilt', 'lean'].map((k) => r.analysis.head[k].accuracy.px);
    return v.every((x) => typeof x === 'number') ? mean(v) : null;
  } },
  { key: 'wrongPct', title: 'Wrong selections, dwell (%)', digits: 1, pick: (r) => r.selection.summary.wrongPct },
  { key: 'timeS', title: 'Time per correct selection, dwell (s)', digits: 2, pick: (r) => (r.selection.summary.timeMs == null ? null : r.selection.summary.timeMs / 1000) },
  { key: 'falsePerMin', title: 'False activations per min (rest, dwell)', digits: 2, pick: (r) => r.rest.perMin },
  { key: 'drift', title: 'Drift warnings', digits: 1, pick: (r) => r.drift.warnings },
];

/**
 * ADR 0003: the sessions of the last recording day (UTC date of createdAt) are
 * held out. Synthetic sessions are used only in a pipeline check.
 */
function splitSessions(sessions, { synthetic = false } = {}) {
  const used = sessions.filter((s) => (synthetic ? s.synthetic === true : s.synthetic !== true));
  const day = (s) => String(s.createdAt).slice(0, 10);
  const days = [...new Set(used.map(day))].sort();
  if (days.length < 2) return { days, heldOutDay: null, heldOut: [], development: used };
  const heldOutDay = days[days.length - 1];
  return { days, heldOutDay, heldOut: used.filter((s) => day(s) === heldOutDay), development: used.filter((s) => day(s) !== heldOutDay) };
}

/** Every variant's figures for each session: {variantId: [{id, figures, result}]} */
function runVariants(sessions, replay) {
  const out = {};
  for (const v of VARIANTS) {
    out[v.id] = sessions.map((s) => {
      const result = replay(s, { improvements: v.improvements, m1: false });
      return { id: s.id, result, figures: Object.fromEntries(FIGURES.map((f) => [f.key, f.pick(result)])) };
    });
  }
  return out;
}

/** Mean ± SD over sessions of each figure, with n and the ids behind it. */
function summarise(perSession) {
  return Object.fromEntries(FIGURES.map((f) => [f.key, Replay.aggregate(perSession, (x) => x.figures[f.key])]));
}

/**
 * ADR 0003, decision 5. `base` and `v` are summarise() results (only `.mean` is read).
 * @returns {{verdict: 'meets'|'does not meet'|'cannot be judged', accuracyGainPct: number|null, reasons: string[]}}
 */
function judge(base, v) {
  const names = { accuracy9: 'accuracy', p95: 'p95', wrongPct: 'wrong selections', falsePerMin: 'false activations', timeS: 'time per correct selection' };
  const missing = Object.keys(names).filter((k) => !(base[k] && typeof base[k].mean === 'number') || !(v[k] && typeof v[k].mean === 'number'));
  if (missing.length) return { verdict: 'cannot be judged', accuracyGainPct: null, reasons: missing.map((k) => `no figure for ${names[k]}`) };
  const accuracyGainPct = base.accuracy9.mean > 0 ? ((base.accuracy9.mean - v.accuracy9.mean) / base.accuracy9.mean) * 100 : null;
  const reasons = [];
  // Rounded so that "exactly 15 %" is not lost to floating point.
  const gains = [];
  if (accuracyGainPct != null && Math.round(accuracyGainPct * 1e9) / 1e9 >= 15) gains.push('accuracy 15 % or more better');
  if (v.p95.mean < base.p95.mean) gains.push('lower p95');
  if (v.wrongPct.mean < base.wrongPct.mean) gains.push('fewer wrong selections');
  if (!gains.length) reasons.push('no gain: accuracy less than 15 % better, p95 not lower, wrong selections not fewer');
  if (v.falsePerMin.mean > base.falsePerMin.mean) reasons.push('more false activations');
  if (v.timeS.mean > base.timeS.mean) reasons.push('longer time per correct selection');
  return { verdict: gains.length && reasons.length === 0 ? 'meets' : 'does not meet', accuracyGainPct, reasons: gains.length && !reasons.length ? gains : reasons };
}

// ── Formatting ───────────────────────────────────────────────────────

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function cell(agg, digits) {
  if (!agg || agg.mean == null) return MISSING;
  return agg.n > 1 ? `${agg.mean.toFixed(digits)} ± ${agg.sd.toFixed(digits)}` : agg.mean.toFixed(digits);
}

const signed = (x) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(1)} %`;

/** One table of all variants over a set of sessions. */
function variantTable(summaries, sessionCount, label, withVerdict) {
  const head = ['Variant', 'Accuracy 9-pt (px)', 'Change in accuracy', 'Accuracy 16-pt (px)', 'p95 9-pt (px)', 'After head movement (px)',
                'Wrong selections, dwell (%)', 'Time per correct selection, dwell (s)', 'False activations / min', 'Drift warnings', 'n', 'Label'];
  if (withVerdict) head.push('Verdict');
  const base = summaries.baseline;
  const rows = VARIANTS.map((v) => {
    const s = summaries[v.id];
    const has = sessionCount > 0 && s && s.accuracy9.n > 0;
    const change = v.id === 'baseline' || !has || !(base.accuracy9.mean > 0) ? MISSING
      : signed(((s.accuracy9.mean - base.accuracy9.mean) / base.accuracy9.mean) * 100);
    const row = [v.label, cell(s && s.accuracy9, 1), change, ...['accuracy16', 'p95', 'head', 'wrongPct', 'timeS', 'falsePerMin', 'drift']
      .map((k) => cell(s && s[k], FIGURES.find((f) => f.key === k).digits)),
      sessionCount ? String(sessionCount) : MISSING, sessionCount ? label : MISSING];
    if (withVerdict) row.push(v.id === 'baseline' || !sessionCount ? MISSING : judge(base, s).verdict);
    return row;
  });
  return table(head, rows);
}

/**
 * @param {object[]} sessions
 * @param {object}   [o]
 * @param {boolean}  [o.synthetic]   pipeline check: use (only) synthetic sessions, label everything synthetic
 * @param {Function} [o.replay]      (session, options) → replay result (default Replay.replaySession)
 * @param {string}   [o.generatedAt]
 * @param {string}   [o.code]
 * @param {object[]} [o.skipped]     files that could not be loaded
 */
function buildAblationReport(sessions, o = {}) {
  const synthetic = o.synthetic === true;
  const replay = o.replay || Replay.replaySession;
  const label = synthetic ? 'synthetic' : 'replayed real';
  const split = splitSessions(sessions, { synthetic });
  const all = [...split.development, ...split.heldOut];
  const runs = runVariants(all, replay);
  const of = (set) => Object.fromEntries(VARIANTS.map((v) => [v.id, summarise(runs[v.id].filter((x) => set.some((s) => s.id === x.id)))]));
  const out = [];
  const p = (...lines) => out.push(...lines, '');

  if (synthetic) {
    p('# LumiIQ — SYNTHETIC check of the Phase C comparison', '',
      '> **These are not results.** Every number below comes from simulated sessions (a software "person" whose eyes',
      '> follow a simple rule). The file only shows that the comparison runs end to end.');
  } else {
    p('# LumiIQ — Phase C: each improvement against the baseline', '',
      'Written by `npm run eval:ablation` from the sessions in `eval/sessions/`. Do not edit by hand: run the command again.');
  }
  p(`*Generated ${o.generatedAt || new Date().toISOString()}${o.code ? ` · code: ${o.code}` : ''}*`);
  p('**How to read this**',
    '- Every row replays the **same recorded sessions** through the app\'s own gaze code (`eval/replay.js`) with some',
    '  improvements switched on: none (the baseline, the app as of Phase B), one at a time, or all seven.',
    `- ${synthetic ? '**synthetic**: every figure in this file.' : '**replayed real**: every figure in this file is recomputed from recordings of a person.'}`,
    '- Mean ± SD is across sessions; *n* is the number of sessions. A figure no session provides is shown as "—".',
    '- The split into development and held-out sessions, the figures and the criteria were fixed before any session',
    '  was recorded: `docs/adr/0003-phase-c-ablation.md` (ADR 0003).');

  // ── Held-out ──
  out.push('## Held-out sessions (the result)', '');
  if (!all.length) {
    p('**No sessions have been recorded yet.** Every table below is therefore empty. Record sessions as described in',
      '`docs/RECORDING.md` (on at least two days), then run `npm run eval:ablation` again.');
  } else if (!split.heldOut.length) {
    p(`**There is no held-out set yet:** all sessions are from one day (${split.days[0]}). ADR 0003 holds out the last`,
      'recording day, so record on a second day before reading any comparison as a result.');
  } else {
    p(`The sessions recorded on ${split.heldOutDay} (UTC): ${split.heldOut.map((s) => `\`${s.id}\``).join(', ')}.`);
  }
  p('An improvement **meets the criteria** if its mean is, compared with the baseline\'s, 15 % or more accurate (9-point),',
    'or has a lower p95, or fewer wrong selections, **and** is not worse in false activations per minute or time per',
    'correct selection. Means are compared; with this few sessions no statistical test is claimed.');
  p(variantTable(of(split.heldOut), split.heldOut.length, label, true));

  // ── Development ──
  out.push('## Development sessions (not a result)', '');
  p('Used while changing the code (ADR 0003). Shown so that every recorded session is accounted for; **not a result**.');
  p(variantTable(of(split.development), split.development.length, label, false));

  // ── Sessions ──
  out.push('## Sessions', '');
  if (!all.length) {
    p('None yet.');
  } else {
    p(table(['Session', 'Day (UTC)', 'Set', 'Lighting', 'Improvements on when recorded', 'Replay check'], all.map((s) => {
      // The replay check comes from the variant that matches what was recorded (or an extra replay as recorded).
      const recorded = Replay.recordedFlags(s);
      const match = VARIANTS.find((v) => JSON.stringify(Features.flags(v.improvements)) === JSON.stringify(recorded));
      const r = match ? runs[match.id].find((x) => x.id === s.id).result : replay(s, { m1: false });
      const c = r.checks;
      const check = c.gazeFrames ? `model within ${c.rawMaxDiffPx.toFixed(2)} px, gaze within ${c.gazeMaxDiffPx.toFixed(1)} px of live` : 'no calibrated frames';
      const on = Object.keys(recorded).filter((n) => recorded[n]);
      return [`\`${s.id}\``, String(s.createdAt).slice(0, 10), split.heldOut.includes(s) ? 'held-out' : 'development',
              (s.setup && s.setup.lighting) || 'not stated', on.length === 0 ? 'none' : on.length === 7 ? 'C1–C7' : on.join(', '), check];
    })));
  }
  if (o.skipped && o.skipped.length) p('**Files that could not be used:**', ...o.skipped.map((s) => `- \`${s.file}\`: ${s.reason}`));

  // ── Limits ──
  p('## What a replay cannot show',
    '- The person reacted to the cursor they saw live. Selection and rest figures are estimates of what a variant',
    '  would have done with the same eye movements. Blink selection is not replayed.',
    '- A variant can drop calibration frames the live run kept, but cannot add frames the live run did not collect.',
    '- C4 waits 300 ms after a target appears; the app already waits 500 ms, so C4 is expected to equal the baseline.',
    '- C7 changes only when the recalibration warning appears (the drift warnings column), no accuracy figure.',
    '- C1 assumes a head-turn gain of 0.4 and MediaPipe\'s head-matrix sign convention; neither is yet checked on a',
    '  real camera.');
  return out.join('\n');
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const synthetic = argv.includes('--synthetic');
  const outFile = arg('--out') || (synthetic ? SYNTHETIC_FILE : OUT_FILE);
  let sessions, skipped = [];
  if (synthetic) {
    const count = parseInt(arg('--count') || '3', 10);
    // The last simulated session is put on a later day, so the check has a held-out set.
    sessions = (await Report.simulateSessions(count)).map((s, i) => ({ ...s, createdAt: i === count - 1 ? '2026-01-02T09:00:00.000Z' : '2026-01-01T09:00:00.000Z' }));
  } else {
    ({ sessions, skipped } = Report.loadSessions(arg('--sessions') || Replay.SESSIONS_DIR));
  }
  const used = splitSessions(sessions, { synthetic });
  const n = used.development.length + used.heldOut.length;
  fs.writeFileSync(outFile, buildAblationReport(sessions, { synthetic, skipped, code: Report.codeVersion() }), 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), outFile)} from ${n} session${n === 1 ? '' : 's'} ` +
              `(${used.heldOut.length} held out)` + (synthetic ? ' (SYNTHETIC: not results)' : '') +
              (skipped.length ? `; ${skipped.length} file(s) skipped` : '') + '.');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
}

module.exports = { VARIANTS, FIGURES, splitSessions, runVariants, summarise, judge, buildAblationReport, OUT_FILE, SYNTHETIC_FILE };
