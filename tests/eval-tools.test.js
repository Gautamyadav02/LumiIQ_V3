const test = require('node:test');
const assert = require('node:assert');
const { pxToDegrees, computeGazeMetrics, computeSelectionMetrics, computeFalseActivationsPerMin } = require('../eval/metrics.js');
const { SessionRecorder } = require('../eval/session-recorder.js');
const { replaySession } = require('../eval/replay.js');
const { GazeCalibration } = require('../gaze/gaze-calibration.js');

test('pxToDegrees accurately converts screen offset to degrees of visual angle', () => {
  // Screen width: 344mm, 1920px (0.179mm/px). Distance: 500mm.
  // 100px = 17.92mm. tan(theta/2) = (17.92/2) / 500 = 0.01792 rad -> 2.05 degrees.
  const deg = pxToDegrees(100, 344, 1920, 500);
  assert.ok(deg > 2.0 && deg < 2.1, `Expected ~2.05 deg, got ${deg}`);
  assert.strictEqual(pxToDegrees(0, 344, 1920, 500), 0);
});

test('computeGazeMetrics calculates accuracy, precision, and p95 correctly', () => {
  const geom = { screenWidthMm: 344, screenWidthPx: 1920, distanceMm: 500 };
  const target = { x: 500, y: 500 };
  // 5 samples around target with known offsets
  const samples = [
    { pred: { x: 500, y: 500 }, target }, // 0px error
    { pred: { x: 510, y: 500 }, target }, // 10px error
    { pred: { x: 490, y: 500 }, target }, // 10px error
    { pred: { x: 500, y: 510 }, target }, // 10px error
    { pred: { x: 500, y: 490 }, target }, // 10px error
  ];

  const m = computeGazeMetrics(samples, geom);
  assert.strictEqual(m.sampleCount, 5);
  // Mean error: (0 + 10 + 10 + 10 + 10) / 5 = 8 px
  assert.strictEqual(m.accuracyPx, 8);
  assert.ok(m.accuracyDeg > 0);
  // Centroid is (500, 500), distance to centroid: 0, 10, 10, 10, 10 -> RMS = sqrt(400/5) = 8.94 px
  assert.strictEqual(m.precisionPx, 8.94);
  assert.strictEqual(m.p95Px, 10);
});

test('computeSelectionMetrics computes correct, wrong, missed rates and average duration', () => {
  const trials = [
    { target: 'A', selected: 'A', durationMs: 800, correct: true },
    { target: 'B', selected: 'B', durationMs: 1200, correct: true },
    { target: 'C', selected: 'D', durationMs: 900, correct: false },
    { target: 'E', selected: null, durationMs: 2000, correct: false },
  ];
  const sm = computeSelectionMetrics(trials);
  assert.strictEqual(sm.totalTrials, 4);
  assert.strictEqual(sm.correct, 2);
  assert.strictEqual(sm.wrong, 1);
  assert.strictEqual(sm.missed, 1);
  assert.strictEqual(sm.accuracyRate, 50); // 50%
  assert.strictEqual(sm.meanTimeMs, 1000); // (800 + 1200) / 2
});

test('computeFalseActivationsPerMin calculates rate accurately', () => {
  // 3 false clicks in 2 minutes (120000ms) = 1.5 per min
  const rate = computeFalseActivationsPerMin(3, 120000);
  assert.strictEqual(rate, 1.5);
  assert.strictEqual(computeFalseActivationsPerMin(0, 60000), 0);
});

test('SessionRecorder records numerical features and events without video/image data', () => {
  const rec = new SessionRecorder({ condition: 'test_baseline' });
  assert.throws(() => rec.start(false), /consent/);

  rec.start(true);
  assert.strictEqual(rec.isRecording, true);

  rec.setPhase('validation', { x: 0.5, y: 0.5 });
  rec.recordFrame({
    t: 1000,
    features: [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.25, 0.1, 0.1],
    confidence: 0.95,
    earL: 0.25,
    earR: 0.25,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    predRaw: { x: 0.5, y: 0.5 },
    predStabilized: { x: 960, y: 540 },
  });

  const session = rec.stop();
  assert.strictEqual(session.metadata.condition, 'test_baseline');
  assert.strictEqual(session.frames.length, 1);
  assert.strictEqual(session.frames[0].confidence, 0.95);
  assert.strictEqual(session.events.length, 3); // session_start, phase_change, session_end
  // Ensure no image buffers or video objects exist
  assert.strictEqual(typeof session.frames[0].features[0], 'number');
});

test('replaySession executes session frames and computes accuracy against validation targets', () => {
  // Construct a synthetic recorded session
  const cal = new GazeCalibration();
  let t = cal.begin(5);
  while (t) {
    for (let i = 0; i < 15; i++) {
      cal.addSample([t.x * 0.7, t.y * 0.6, t.x * 0.7, t.y * 0.6, 0, 0, 0, 0.3, 0.1, 0.1]);
    }
    const res = cal.commitPoint();
    t = res.next;
  }
  cal.train({ width: 1000, height: 1000 });

  const session = {
    metadata: {
      sessionId: 'test_rep',
      screenWidth: 1000,
      screenHeight: 1000,
      calibration: cal.toJSON(),
    },
    frames: [
      // 10 validation frames targeting (0.5, 0.5)
      ...Array.from({ length: 10 }, (_, i) => ({
        t: 1000 + i * 33,
        phase: 'validation',
        target: { x: 0.5, y: 0.5 },
        features: [0.35, 0.3, 0.35, 0.3, 0, 0, 0, 0.3, 0.1, 0.1],
        confidence: 0.95,
      })),
    ],
  };

  const rep = replaySession(session);
  assert.strictEqual(rep.sessionId, 'test_rep');
  assert.strictEqual(rep.metrics.sampleCount, 10);
  assert.ok(rep.metrics.accuracyPx >= 0);
  assert.ok(rep.targetBreakdown['0.50,0.50']);
});
