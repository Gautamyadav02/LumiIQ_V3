'use strict';
// Phase B: eval/report.js writes eval/BASELINE.md (dissertation Tables 4.6 and
// 4.7) from the sessions in eval/sessions/. The sessions used here come from
// the real wizard driven by a simulated person: every number is SYNTHETIC.
// They are left unmarked only where a test needs the "real sessions" path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Report = require('../eval/report.js');
const Replay = require('../eval/replay.js');
const { SessionRecorder } = require('../eval/session-recorder.js');
const { setupWizard } = require('./helpers/wizard');

const QUICK_PLAN = { REST_MS: 6000, FIXATION_MS: 3000 };
const made = {};
async function simulated(seed, lighting = 'daylight') {
  const key = `${seed}-${lighting}`;
  if (!made[key]) {
    const w = setupWizard({ plan: QUICK_PLAN, person: { seed } });
    w.el.evalStartBtn.click();
    assert.equal(w.runUntil('summary'), true);
    await w.flush();
    made[key] = { ...w.uploads[0].session, id: `2026-10-1${seed}T09-00-00Z-sim${seed}`,
                  createdAt: `2026-10-1${seed}T09:00:00.000Z`, setup: { ...w.uploads[0].session.setup, lighting } };
  }
  return JSON.parse(JSON.stringify(made[key]));
}

// Replaying a session takes a second or two; each one is replayed once for all the tests.
const replays = new Map();
const replay = (session) => {
  if (!replays.has(session.id)) replays.set(session.id, Replay.replaySession(session));
  return replays.get(session.id);
};
const report = (sessions, o = {}) => Report.buildReport(sessions, { generatedAt: '2026-10-14T10:00:00.000Z', replay, ...o });

/** The body rows of the first markdown table after a heading, as arrays of cells. */
function tableAfter(markdown, heading) {
  const at = markdown.indexOf(heading);
  assert.notEqual(at, -1, `the report has a section "${heading}"`);
  const lines = markdown.slice(at).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

const TABLE_A_ROWS = [
  'Default settings, 9-point calibration', 'Default settings, 16-point calibration', 'Header and right-edge targets only',
  'After head turn (about 5° left/right)', 'After head tilt (up/down)', 'Leaning closer/farther',
  'In-app estimate for the same calibration',
];

test('with no sessions it writes a template: every row is there and no cell holds a number', () => {
  const md = report([]);
  assert.match(md, /No sessions have been recorded yet/);
  const a = tableAfter(md, 'Table A');
  assert.deepEqual(a.map((r) => r[0]), TABLE_A_ROWS);
  for (const row of a) for (const cell of row.slice(1, 5)) assert.equal(cell, '—', `"${row[0]}" has no number`);
  const b = tableAfter(md, 'Table B');
  assert.deepEqual(b.map((r) => r[0]), ['Wrong selections (%)', 'Missed prompts (%)', 'Time per correct selection (s)',
                                        'False activations per minute (rest period)']);
  for (const row of b) for (const cell of row.slice(1, 3)) assert.equal(cell, '—');
  const lag = tableAfter(md, 'Lag and jitter');
  assert.deepEqual(lag.map((r) => r[0]), ['Settling time (ms)', 'Fixation jitter (px, RMS)']);
  // Nothing that looks like a measurement anywhere in the tables.
  const cells = [...a, ...b, ...lag].flatMap((r) => r.slice(1));
  assert.ok(!cells.some((c) => /\d+(\.\d+)?\s*(px|°|%|ms|s\b)/.test(c)), 'no measurement appears in a template');
});

test('Table A: accuracy and precision for x and y, in px and degrees, as mean ± SD with n', async () => {
  const sessions = [await simulated(1), await simulated(2), await simulated(3)];
  const md = report(sessions);
  const rows = tableAfter(md, 'Table A');
  assert.deepEqual(rows.map((r) => r[0]), TABLE_A_ROWS);
  const results = sessions.map(replay);
  const agg = Replay.aggregate(results, (r) => r.analysis.validation.val9.standard.accuracy.x.px);
  const aggDeg = Replay.aggregate(results, (r) => r.analysis.validation.val9.standard.accuracy.x.deg);
  const first = rows[0];
  assert.equal(first[1], `${agg.mean.toFixed(1)} ± ${agg.sd.toFixed(1)} px / ${aggDeg.mean.toFixed(2)} ± ${aggDeg.sd.toFixed(2)}°`);
  assert.equal(first[5], '3');
  assert.equal(first[6], 'replayed real');
  for (const row of rows.slice(0, 6)) {
    for (const cell of row.slice(1, 5)) assert.match(cell, /^\d+\.\d ± \d+\.\d px \/ \d+\.\d\d ± \d+\.\d\d°$/, `${row[0]}: ${cell}`);
    assert.equal(row[5], '3');
  }
  // The in-app estimate has no precision: the app does not estimate one.
  const inApp = rows[6];
  assert.match(inApp[1], /px \/ .*°$/);
  assert.equal(inApp[3], 'n/a');
  assert.equal(inApp[4], 'n/a');
});

test('Table B: selection by dwell and by blink, false activations, and lag at both smoothing levels', async () => {
  const sessions = [await simulated(1), await simulated(2), await simulated(3)];
  const md = report(sessions);
  const b = tableAfter(md, 'Table B');
  assert.match(b[0][1], /^\d+\.\d ± \d+\.\d %$/);            // wrong %, dwell
  assert.match(b[0][2], /^\d+\.\d ± \d+\.\d %$/);            // wrong %, blink
  assert.match(b[2][1], /^\d+\.\d\d ± \d+\.\d\d s$/);        // time per correct selection
  assert.match(b[3][1], /per min$/);
  assert.ok(b.every((r) => r[3] === '3' && r[4] === 'live real'), 'selection and rest figures were measured live');
  const lag = tableAfter(md, 'Lag and jitter');
  assert.match(lag[0][1], /ms$/);
  assert.match(lag[1][2], /px$/);
  assert.match(md, /smoothing 0\.35/i);
  assert.match(md, /smoothing 0\.06/i);
});

test('the report names its sessions: ids per row, dates, distance, screen and lighting', async () => {
  const sessions = [await simulated(1, 'daylight'), await simulated(2, 'dim'), await simulated(3, 'dim')];
  const md = report(sessions);
  const list = tableAfter(md, 'Sessions');
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((r) => r[0]), sessions.map((s) => `\`${s.id}\``));
  assert.deepEqual(list.map((r) => r[2]), ['daylight', 'dim', 'dim']);
  assert.ok(list.every((r) => r[1].startsWith('2026-10-1') && r[3] === '60 cm' && r[4].startsWith('30.5 cm')));
  assert.match(md, /3 sessions on 3 days/);
  assert.match(md, /daylight: 1.*dim: 2/s);
  const used = tableAfter(md, 'Sessions behind each row');
  assert.ok(used.length >= 11, 'every row of Tables A and B is listed');
  for (const row of used) for (const s of sessions) assert.ok(row[1].includes(s.id), `${row[0]} lists ${s.id}`);
});

test('the 95th-percentile error and the smallest target it allows', async () => {
  const sessions = [await simulated(1), await simulated(2)];
  const md = report(sessions);
  const results = sessions.map(replay);
  const p95 = Replay.aggregate(results, (r) => r.analysis.validation.val9.standard.p95.px);
  const rows = tableAfter(md, '95th-percentile error');
  assert.match(rows[0][1], new RegExp(`^${p95.mean.toFixed(1)} ± ${p95.sd.toFixed(1)} px`));
  assert.match(rows[0][2], new RegExp(`^${(2 * p95.mean).toFixed(0)} px`), 'minimum target size = 2 × p95');
  assert.match(md, /twice the 95th-percentile error/);
  assert.match(md, /smaller than this/, 'and how the current targets compare');
});

test('M1: the old and the new in-app estimate beside the held-out error', async () => {
  const md = report([await simulated(1), await simulated(2)]);
  const rows = tableAfter(md, 'In-app estimate against the held-out error');
  assert.deepEqual(rows.map((r) => r[0]), ['In-app estimate, interleaved folds (old)', 'In-app estimate, leave-one-target-out (new)',
                                           'Measured on the 12 held-out targets']);
  for (const row of rows) assert.match(row[1], /px \/ .*°$/);
});

test('one session gives values without a spread, and says so', async () => {
  const md = report([await simulated(1)]);
  const first = tableAfter(md, 'Table A')[0];
  assert.match(first[1], /^\d+\.\d px \/ \d+\.\d\d°$/);
  assert.equal(first[5], '1');
  assert.match(md, /fewer than 3 sessions/i);
});

test('a session marked synthetic never enters the tables', async () => {
  const fake = { ...(await simulated(1)), synthetic: true };
  const md = report([fake]);
  assert.match(md, /No sessions have been recorded yet/);
  assert.match(md, /1 session marked synthetic was left out/);
  for (const row of tableAfter(md, 'Table A')) assert.equal(row[1], '—');
  // The same session in a pipeline check: everything is labelled synthetic, nothing real.
  const check = report([fake], { synthetic: true });
  assert.match(check, /SYNTHETIC/);
  assert.match(check, /not results/i);
  assert.doesNotMatch(check, /replayed real|live real/);
  assert.equal(tableAfter(check, 'Table A')[0][6], 'synthetic');
});

test('npm run eval:report: an empty folder gives the template; --synthetic writes a separate, marked file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiiq-report-'));
  const script = path.join(__dirname, '..', 'eval', 'report.js');
  try {
    const out = path.join(dir, 'BASELINE.md');
    const run = spawnSync(process.execPath, [script, '--sessions', path.join(dir, 'sessions'), '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /No sessions have been recorded yet/);
    assert.match(run.stdout, /0 sessions/);

    const check = path.join(dir, 'SYNTHETIC-CHECK.md');
    const syn = spawnSync(process.execPath, [script, '--synthetic', '--count', '1', '--out', check], { encoding: 'utf8' });
    assert.equal(syn.status, 0, syn.stderr);
    const text = fs.readFileSync(check, 'utf8');
    assert.match(text, /SYNTHETIC/);
    assert.doesNotMatch(text, /replayed real|live real/);
    assert.match(fs.readFileSync(out, 'utf8'), /No sessions have been recorded yet/, 'the baseline file is untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a session file that is not valid is reported and skipped, not counted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumiiq-report-'));
  try {
    SessionRecorder.writeToDir(await simulated(1), dir);
    fs.writeFileSync(path.join(dir, 'broken.json'), '{"format":"lumiiq-eval-session","version":2,"consent":{"given":false}}');
    fs.writeFileSync(path.join(dir, 'notes.json'), 'not json at all');
    const { sessions, skipped } = Report.loadSessions(dir);
    assert.equal(sessions.length, 1);
    assert.deepEqual(skipped.map((s) => s.file).sort(), ['broken.json', 'notes.json']);
    const md = report(sessions, { skipped });
    assert.match(md, /broken\.json/);
    assert.match(md, /consent/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
