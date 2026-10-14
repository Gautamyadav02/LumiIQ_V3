/**
 * LumiIQ — Evaluation Replay Engine (Phase B)
 *
 * Replays recorded evaluation sessions under Node.js or browser.
 * Feeds recorded feature vectors through real gaze modules (calibration & stabilizer),
 * computing objective metrics without requiring a live user.
 *
 * Usage:
 *   const { replaySession } = require('./eval/replay.js');
 *   const results = replaySession(sessionJSON, { degree: 2, smoothing: 0.35 });
 *
 * CLI:
 *   node eval/replay.js eval/sessions/session_123_eval.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const GazeRegressionMath = require('../gaze/ridge-regression.js');
const { RidgeRegressor } = GazeRegressionMath;
const { GazeCalibration } = require('../gaze/gaze-calibration.js');
const { GazeStabilizer } = require('../gaze/gaze-stabilizer.js');
const { computeGazeMetrics, computeSelectionMetrics } = require('./metrics.js');

/**
 * Replay an evaluation session.
 * @param {object} session  Session JSON object
 * @param {object} [options] Replay configuration
 * @param {number} [options.degree] Override polynomial degree (1 or 2)
 * @param {number} [options.smoothing] Override smoothing factor (0.05 - 0.45)
 * @param {boolean} [options.recalibrate] If true, retrain model on calibration frames in session
 * @param {Function} [options.featureTransform] Optional (features, pose) => modifiedFeatures
 * @returns {object} Replay evaluation report
 */
function replaySession(session, options = {}) {
  if (!session || !session.frames) {
    throw new Error('Invalid session format: missing frames');
  }

  const meta = session.metadata || {};
  const width = meta.screenWidth || 1920;
  const height = meta.screenHeight || 1080;
  const geom = {
    screenWidthMm: meta.screenWidthMm || 344,
    screenWidthPx: width,
    distanceMm: meta.distanceMm || 500,
  };

  // 1. Prepare calibration model
  let calibration = null;
  const degree = options.degree != null ? options.degree : (meta.calibrationReport ? meta.calibrationReport.degree || 2 : 2);

  if (options.recalibrate || !meta.calibration) {
    // Retrain from calibration frames in the session
    const calib = new GazeCalibration({ degree });
    const calibFrames = session.frames.filter((f) => f.phase === 'calibration' && f.target && f.features);
    
    // Group frames by target
    const targetGroups = new Map();
    for (const f of calibFrames) {
      const key = `${f.target.x.toFixed(4)},${f.target.y.toFixed(4)}`;
      if (!targetGroups.has(key)) targetGroups.set(key, { target: f.target, frames: [] });
      targetGroups.get(key).frames.push(f);
    }

    calib.reset();
    calib.layout = Array.from(targetGroups.values()).map((g) => g.target);
    for (let idx = 0; idx < calib.layout.length; idx++) {
      calib.index = idx;
      const group = targetGroups.get(`${calib.layout[idx].x.toFixed(4)},${calib.layout[idx].y.toFixed(4)}`);
      for (const frame of group.frames) {
        let feat = frame.features;
        if (typeof options.featureTransform === 'function') {
          feat = options.featureTransform(feat, frame.pose);
        }
        calib.addSample(feat);
      }
      calib.commitPoint();
    }
    calib.train({ width, height });
    calibration = calib;
  } else {
    calibration = GazeCalibration.fromJSON(meta.calibration);
  }

  // 2. Prepare stabilizer
  const smoothing = options.smoothing != null ? options.smoothing : 0.35;
  const stabilizer = new GazeStabilizer({
    width,
    height,
    minCutoff: 3.5 - smoothing * 4.0,
    beta: 0.04 - smoothing * 0.05,
    deadband: 2.5,
  });

  // 3. Process validation frames
  const validationSamples = [];
  const targetErrors = new Map(); // targetKey -> array of offsets

  for (const frame of session.frames) {
    if (!frame.features) continue;

    let feat = frame.features;
    if (typeof options.featureTransform === 'function') {
      feat = options.featureTransform(feat, frame.pose);
    }

    const norm = calibration && calibration.isReady
      ? calibration.predict(feat)
      : { x: 0.5, y: 0.5 };

    const px = norm.x * width;
    const py = norm.y * height;
    const stabilized = stabilizer.process(px, py, frame.t);

    if (frame.phase === 'validation' && frame.target) {
      const targetPx = {
        x: frame.target.x * width,
        y: frame.target.y * height,
      };

      validationSamples.push({
        pred: stabilized,
        target: targetPx,
        t: frame.t,
      });

      const tKey = `${frame.target.x.toFixed(2)},${frame.target.y.toFixed(2)}`;
      if (!targetErrors.has(tKey)) targetErrors.set(tKey, []);
      targetErrors.get(tKey).push(Math.hypot(stabilized.x - targetPx.x, stabilized.y - targetPx.y));
    }
  }

  // 4. Compute metrics
  const gazeMetrics = computeGazeMetrics(validationSamples, geom);

  // Group by target zone (corners, edges, center, header)
  const targetBreakdown = {};
  for (const [tKey, errs] of targetErrors.entries()) {
    const avgErr = errs.reduce((a, b) => a + b, 0) / errs.length;
    targetBreakdown[tKey] = {
      sampleCount: errs.length,
      meanErrorPx: Math.round(avgErr * 10) / 10,
    };
  }

  return {
    sessionId: meta.sessionId,
    condition: meta.condition,
    degree,
    smoothing,
    metrics: gazeMetrics,
    targetBreakdown,
  };
}

// CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node eval/replay.js <path-to-session.json> [--degree 1|2] [--smoothing 0.35]');
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const degreeArg = args.indexOf('--degree');
  const degree = degreeArg !== -1 ? parseInt(args[degreeArg + 1], 10) : undefined;
  const smoothArg = args.indexOf('--smoothing');
  const smoothing = smoothArg !== -1 ? parseFloat(args[smoothArg + 1]) : undefined;

  const results = replaySession(sessionData, { degree, smoothing });
  console.log('Replay Evaluation Report:');
  console.log(JSON.stringify(results, null, 2));
}

module.exports = { replaySession };
