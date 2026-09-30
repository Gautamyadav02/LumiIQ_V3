'use strict';
/**
 * SYNTHETIC analysis (Phase A2): what the EAR threshold changes, run through the
 * REAL engine and calibration modules with synthetic MediaPipe landmarks.
 * These numbers describe the code's logic, not a real person's eyes.
 *
 *   node eval/synthetic/ear-threshold.js
 */
const { setupEngine, feedFrames } = require('../../tests/helpers/engine');
const { rejectOutliers } = require('../../gaze/gaze-calibration.js');

const line = (s = '') => console.log(s);

// 1. Which eye openings count as "open" and produce gaze / calibration samples.
line('1. Frames admitted as "open" (they produce gaze points and calibration samples)');
line('   EAR of both eyes   threshold 0.11   threshold 0.18');
for (const ear of [0.08, 0.10, 0.12, 0.14, 0.16, 0.20, 0.28]) {
  const cells = [0.11, 0.18].map((threshold) => {
    const ctx = setupEngine({ settings: { earThreshold: threshold } });
    ctx.gaze.startCalibration(5);
    feedFrames(ctx, 330, { openL: ear, openR: ear });          // 10 frames on calibration point 1
    return `${ctx.gaze._calibRun.sampleCount()}/10 samples`;
  });
  line(`   ${ear.toFixed(2).padEnd(18)} ${cells[0].padEnd(16)} ${cells[1]}`);
}

// 2. The eyes-closed alarm needs EAR <= threshold for 3 s.
line();
line('2. Eyes-closed alarm after 4 s at a given EAR (e.g. drowsy, eyes half shut)');
line('   EAR of both eyes   threshold 0.11   threshold 0.18');
for (const ear of [0.05, 0.10, 0.12, 0.14, 0.16]) {
  const cells = [0.11, 0.18].map((threshold) => {
    const ctx = setupEngine({ settings: { earThreshold: threshold } });
    feedFrames(ctx, 200, { openL: 0.28, openR: 0.28 });
    feedFrames(ctx, 4000, { openL: ear, openR: ear });
    return ctx.alerts.some((a) => a.type === 'PROLONGED_CLOSURE') ? 'alarm' : 'no alarm';
  });
  line(`   ${ear.toFixed(2).padEnd(18)} ${cells[0].padEnd(16)} ${cells[1]}`);
}

// 3. Calibration's outlier filter drops a frame only if it is off in MORE than
//    30% of the 10 features. A partly-closed-lid frame moves the lid-dependent
//    features: ly, ry (iris height within the eye opening) and ear.
line();
line('3. Calibration outlier filter (rejectOutliers) on one target: 30 clean frames + 6 disturbed frames');
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const clean = () => [0.5, 0.5, 0.5, 0.5, 2, -3, 1, 0.28, 0.12, 0.11].map((v) => v + rand() * 0.004);
for (const [label, dims] of [['ly, ry, ear shifted (3 of 10 features)', [1, 3, 7]],
                             ['ly, ry, ear, lx shifted (4 of 10 features)', [0, 1, 3, 7]]]) {
  const rows = Array.from({ length: 30 }, clean);
  const bad = Array.from({ length: 6 }, () => { const r = clean(); for (const d of dims) r[d] += 0.1; return r; });
  const kept = rejectOutliers([...rows, ...bad], 1000);
  const badKept = bad.filter((b) => kept.includes(b)).length;
  line(`   ${label.padEnd(44)} disturbed frames kept: ${badKept}/6`);
}
