'use strict';
// Phase C (C8): eval/ablation.js replays every session with the baseline, each
// improvement alone, and all of them, and writes eval/IMPROVEMENTS.md. The split
// into development and held-out sessions and the criteria are fixed in
// docs/adr/0003-phase-c-ablation.md. Every number here is SYNTHETIC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Ablation = require('../eval/ablation.js');
const Replay = require('../eval/replay.js');
const { setupWizard } = require('./helpers/wizard');

/** The body rows of the first markdown table after a heading, as arrays of cells. */
function tableAfter(markdown, heading) {
  const at = markdown.indexOf(heading);
  assert.notEqual(at, -1, `the report has a section "${heading}"`);
  const lines = markdown.slice(at).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  return rows;
}

const session = (id, createdAt, extra = {}) => ({ id, createdAt, setup: { lighting: 'daylight' }, engine: { flags: {} }, ...extra });

test('the variants: the baseline, each improvement alone, and all seven together', () => {
  assert.deepEqual(Ablation.VARIANTS.map((v) => v.id), ['baseline', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'all']);
  assert.equal(Ablation.VARIANTS[0].improvements, 'none');
  assert.deepEqual(Ablation.VARIANTS[3].improvements, ['C3']);
  assert.equal(Ablation.VARIANTS.at(-1).improvements, 'all');
});

test('the split (ADR 0003): the last recording day (UTC) is held out; synthetic sessions are in neither set', () => {
  const s = [session('a', '2026-10-15T09:00:00.000Z'), session('b', '2026-10-16T23:30:00.000Z'),
             session('c', '2026-10-15T18:00:00.000Z'), session('d', '2026-10-16T08:00:00.000Z'),
             session('e', '2026-10-20T10:00:00.000Z', { synthetic: true })];
  const split = Ablation.splitSessions(s);
  assert.deepEqual(split.days, ['2026-10-15', '2026-10-16']);
  assert.equal(split.heldOutDay, '2026-10-16');
  assert.deepEqual(split.heldOut.map((x) => x.id), ['b', 'd']);
  assert.deepEqual(split.development.map((x) => x.id), ['a', 'c']);
  // One day only: no held-out set, so no result.
  const one = Ablation.splitSessions(s.slice(0, 1));
  assert.deepEqual([one.heldOut.length, one.development.length, one.heldOutDay], [0, 1, null]);
  // A pipeline check uses its synthetic sessions, marked as such.
  const check = Ablation.splitSessions(s, { synthetic: true });
  assert.deepEqual([check.development.map((x) => x.id), check.heldOut.length], [['e'], 0], 'one synthetic day: no held-out set either');
});

/** Aggregated figures for judge(): {key: {mean}} */
const figs = (o) => Object.fromEntries(Object.entries({ accuracy9: 100, p95: 200, wrongPct: 10, falsePerMin: 1, timeS: 2, ...o }).map(([k, v]) => [k, { mean: v }]));

test('the criteria (ADR 0003): 15 % better accuracy, or lower p95, or fewer wrong selections; and no regression', () => {
  const base = figs({});
  assert.equal(Ablation.judge(base, figs({ accuracy9: 85 })).verdict, 'meets', 'exactly 15 % better');
  assert.equal(Ablation.judge(base, figs({ accuracy9: 85.1 })).verdict, 'does not meet', '14.9 % is not enough');
  assert.equal(Ablation.judge(base, figs({ p95: 199 })).verdict, 'meets');
  assert.equal(Ablation.judge(base, figs({ wrongPct: 9 })).verdict, 'meets');
  assert.equal(Ablation.judge(base, figs({})).verdict, 'does not meet', 'identical to the baseline');
  const worseFalse = Ablation.judge(base, figs({ accuracy9: 50, falsePerMin: 1.01 }));
  assert.equal(worseFalse.verdict, 'does not meet');
  assert.match(worseFalse.reasons.join(' '), /false activations/);
  const slower = Ablation.judge(base, figs({ accuracy9: 50, timeS: 2.1 }));
  assert.equal(slower.verdict, 'does not meet');
  assert.match(slower.reasons.join(' '), /time per correct selection/);
  assert.equal(Math.round(Ablation.judge(base, figs({ accuracy9: 80 })).accuracyGainPct), 20);
  // A missing figure is never filled in.
  const missing = Ablation.judge(base, figs({ wrongPct: null }));
  assert.equal(missing.verdict, 'cannot be judged');
  assert.match(missing.reasons.join(' '), /wrong selections/);
});

test('every session is replayed with every variant, without the M1 extra replay', () => {
  const calls = [];
  const replay = (s, o) => { calls.push([s.id, JSON.stringify(o.improvements), o.m1]); return fakeResult(s.id, 50); };
  const s = [session('a', '2026-10-15T09:00:00.000Z'), session('b', '2026-10-16T09:00:00.000Z')];
  Ablation.buildAblationReport(s, { replay, generatedAt: 'x' });
  for (const id of ['a', 'b']) {
    assert.deepEqual(calls.filter((c) => c[0] === id).map((c) => c[1]),
                     ['"none"', '["C1"]', '["C2"]', '["C3"]', '["C4"]', '["C5"]', '["C6"]', '["C7"]', '"all"']);
  }
  assert.ok(calls.every((c) => c[2] === false));
});

/** A replay result with the fields the ablation reads. */
function fakeResult(id, accuracy, o = {}) {
  const v = (px) => ({ accuracy: { px }, p95: { px: px * 2 } });
  return {
    id, checks: { gazeFrames: 100, rawMaxDiffPx: 0.001, gazeMaxDiffPx: 0.5 },
    analysis: { validation: { val9: { standard: v(accuracy) }, val16: { standard: v(accuracy - 5) } },
                head: { turn: { accuracy: { px: accuracy + 10 } }, tilt: { accuracy: { px: accuracy + 20 } }, lean: { accuracy: { px: accuracy + 30 } } } },
    selection: { summary: { wrongPct: o.wrongPct != null ? o.wrongPct : 10, timeMs: o.timeMs != null ? o.timeMs : 2000 } },
    rest: { perMin: o.perMin != null ? o.perMin : 0.5 },
    drift: { warnings: 0, mode: 'legacy' },
  };
}

test('the held-out table: mean ± SD, the change in accuracy, n, a label and a verdict per row; development apart', () => {
  // Development day: accuracy 80 and 120; held-out day: 100 and 110 (baseline). C1 halves it on the held-out day.
  const acc = { a: 80, b: 120, c: 100, d: 110 };
  const replay = (s, o) => fakeResult(s.id, JSON.stringify(o.improvements) === '["C1"]' ? acc[s.id] / 2 : acc[s.id]);
  const s = [session('a', '2026-10-15T09:00:00.000Z'), session('b', '2026-10-15T11:00:00.000Z'),
             session('c', '2026-10-16T09:00:00.000Z'), session('d', '2026-10-16T11:00:00.000Z')];
  const md = Ablation.buildAblationReport(s, { replay, generatedAt: 'x' });
  const held = tableAfter(md, 'Held-out sessions');
  assert.deepEqual(held.map((r) => r[0].split(':')[0]), ['Baseline (Phase B)', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'All of C1–C7']);
  const [base, c1] = held;
  assert.equal(base[1], '105.0 ± 7.1');                  // mean and SD of 100 and 110
  assert.equal(base[2], '—', 'the baseline is the reference');
  assert.equal(c1[1], '52.5 ± 3.5');
  assert.equal(c1[2], '−50.0 %');
  assert.equal(c1[3], '47.5 ± 3.5', 'the 16-point accuracy');
  assert.equal(c1[5], '72.5 ± 3.5', 'after head movement: mean of turn, tilt and lean');
  assert.equal(base.at(-3), '2', 'n');
  assert.equal(base.at(-2), 'replayed real');
  assert.equal(c1.at(-1), 'meets');
  assert.equal(held[2].at(-1), 'does not meet', 'C2: identical to the baseline here');
  const dev = tableAfter(md, 'Development sessions');
  assert.equal(dev[0][1], '100.0 ± 28.3');
  assert.match(md, /not a result/i);
  assert.match(md, /ADR 0003/);
  // Each session's set and day.
  const list = tableAfter(md, 'Sessions');
  assert.deepEqual(list.map((r) => [r[0], r[1], r[2]]), [['`a`', '2026-10-15', 'development'], ['`b`', '2026-10-15', 'development'],
                                                          ['`c`', '2026-10-16', 'held-out'], ['`d`', '2026-10-16', 'held-out']]);
});

test('with no sessions it writes a template: every row is there and no cell holds a number', () => {
  const md = Ablation.buildAblationReport([], { generatedAt: 'x' });
  assert.match(md, /No sessions have been recorded yet/);
  const held = tableAfter(md, 'Held-out sessions');
  assert.equal(held.length, 9);
  for (const row of held) for (const cell of row.slice(1, -2)) assert.equal(cell, '—', `${row[0]}: ${cell}`);
  assert.ok(held.every((r) => r.at(-1) === '—'));
  assert.doesNotMatch(md, /\d+\.\d+ ± /);
});

test('sessions from one day only: no held-out set, said plainly, and no verdict', () => {
  const replay = (s) => fakeResult(s.id, 100);
  const md = Ablation.buildAblationReport([session('a', '2026-10-15T09:00:00.000Z')], { replay, generatedAt: 'x' });
  assert.match(md, /no held-out set/i);
  assert.ok(tableAfter(md, 'Held-out sessions').every((r) => r.at(-1) === '—'));
  assert.equal(tableAfter(md, 'Development sessions')[0][1], '100.0');
});

test('end to end on simulated sessions: the cells are the replays\' own figures, all labelled synthetic', async () => {
  const sessions = [];
  for (const [seed, day] of [[1, '2026-10-15'], [2, '2026-10-16']]) {
    const w = setupWizard({ plan: { REST_MS: 6000, FIXATION_MS: 3000 }, person: { seed } });
    assert.equal(w.runUntil('summary'), true);
    await w.flush();
    sessions.push({ ...JSON.parse(JSON.stringify(w.uploads[0].session)), id: `SYNTHETIC-${seed}`, createdAt: `${day}T09:00:00.000Z`, synthetic: true });
  }
  const md = Ablation.buildAblationReport(sessions, { synthetic: true, generatedAt: 'x' });
  assert.match(md, /SYNTHETIC/);
  assert.doesNotMatch(md, /replayed real|live real/);
  const held = tableAfter(md, 'Held-out sessions');
  const expect = (improvements) => Replay.replaySession(sessions[1], { improvements, m1: false }).analysis.validation.val9.standard.accuracy.px.toFixed(1);
  assert.equal(held[0][1], expect('none'), 'the baseline cell is the held-out session replayed with everything off');
  assert.equal(held.at(-1)[1], expect('all'));
  assert.ok(held.every((r) => r.at(-2) === 'synthetic' && r.at(-3) === '1'));
  // The replay check uses the variant that matches what was recorded (here, all on).
  const list = tableAfter(md, 'Sessions');
  assert.ok(list.every((r) => /model within 0\.0\d px/.test(r.at(-1))), list.map((r) => r.at(-1)).join('; '));
});

test('npm run eval:ablation: an empty folder gives the template; --synthetic writes a separate, marked file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiiq-ablation-'));
  const script = path.join(__dirname, '..', 'eval', 'ablation.js');
  try {
    const out = path.join(dir, 'IMPROVEMENTS.md');
    const run = spawnSync(process.execPath, [script, '--sessions', path.join(dir, 'sessions'), '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /No sessions have been recorded yet/);
    assert.match(run.stdout, /0 sessions/);
    assert.equal(Ablation.SYNTHETIC_FILE.endsWith('SYNTHETIC-ABLATION.md'), true);
    const ignored = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.match(ignored, /eval\/SYNTHETIC-ABLATION\.md/, 'the synthetic check is never committed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
