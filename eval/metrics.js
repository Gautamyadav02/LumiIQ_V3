/**
 * LumiIQ — Evaluation Metrics (Phase B)
 *
 * Implements objective gaze tracking performance metrics:
 * - Accuracy: mean offset from target (pixels and degrees of visual angle)
 * - Precision: RMS spread of gaze around its own centroid during fixation
 * - 95th-percentile error: worst-case boundary (px and degrees)
 * - Selection metrics: correct, wrong, missed selections, mean time per selection
 * - False activations per minute (during rest period)
 * - Settling time: latency from target appearance to eye landing on target
 * - Visual angle conversion (px -> degrees) given geometry
 */
(function (root) {
  'use strict';

  /**
   * Convert pixel distance to degrees of visual angle.
   * @param {number} pxDist       Distance in screen pixels
   * @param {number} screenWidthMm Screen width in mm (e.g. 344 for 15.6" laptop)
   * @param {number} screenWidthPx Screen width in pixels (e.g. 1920 or 1440)
   * @param {number} distanceMm    Viewing distance in mm (e.g. 500 or 600)
   * @returns {number} Degrees of visual angle
   */
  function pxToDegrees(pxDist, screenWidthMm, screenWidthPx, distanceMm) {
    if (!pxDist || pxDist <= 0 || !screenWidthMm || !screenWidthPx || !distanceMm) return 0;
    const sizeMm = pxDist * (screenWidthMm / screenWidthPx);
    const rad = 2 * Math.atan(sizeMm / (2 * distanceMm));
    return (rad * 180) / Math.PI;
  }

  /**
   * Calculate accuracy and precision metrics from a series of (prediction, target) pairs.
   * @param {Array<{pred: {x:number, y:number}, target: {x:number, y:number}}>} samples
   * @param {object} [geom] Optional { screenWidthMm, screenWidthPx, distanceMm }
   * @returns {object} Accuracy and precision metrics
   */
  function computeGazeMetrics(samples, geom = null) {
    if (!samples || samples.length === 0) {
      return {
        sampleCount: 0,
        accuracyPx: 0,
        accuracyDeg: 0,
        precisionPx: 0,
        precisionDeg: 0,
        p95Px: 0,
        p95Deg: 0,
        errorsX: { mean: 0, std: 0 },
        errorsY: { mean: 0, std: 0 },
      };
    }

    const n = samples.length;
    const offsets = [];
    let sumErr = 0;
    let sumSqErr = 0;
    let sumX = 0, sumY = 0;
    let sumDiffX = 0, sumDiffY = 0;

    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const dx = s.pred.x - s.target.x;
      const dy = s.pred.y - s.target.y;
      const dist = Math.hypot(dx, dy);
      offsets.push(dist);
      sumErr += dist;
      sumSqErr += dist * dist;
      sumDiffX += dx;
      sumDiffY += dy;
      sumX += s.pred.x;
      sumY += s.pred.y;
    }

    // Accuracy: mean Euclidean distance from target
    const accuracyPx = sumErr / n;

    // 95th percentile error
    offsets.sort((a, b) => a - b);
    const p95Idx = Math.min(n - 1, Math.floor(n * 0.95));
    const p95Px = offsets[p95Idx];

    // Precision: RMS distance from the centroid of predictions (spread during fixation)
    const centroidX = sumX / n;
    const centroidY = sumY / n;
    let sumSqCentroidDist = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const cdx = s.pred.x - centroidX;
      const cdy = s.pred.y - centroidY;
      sumSqCentroidDist += cdx * cdx + cdy * cdy;
    }
    const precisionPx = Math.sqrt(sumSqCentroidDist / n);

    const degHelper = (px) => (geom ? pxToDegrees(px, geom.screenWidthMm, geom.screenWidthPx, geom.distanceMm) : null);

    return {
      sampleCount: n,
      accuracyPx: Math.round(accuracyPx * 100) / 100,
      accuracyDeg: geom ? Math.round(degHelper(accuracyPx) * 100) / 100 : null,
      precisionPx: Math.round(precisionPx * 100) / 100,
      precisionDeg: geom ? Math.round(degHelper(precisionPx) * 100) / 100 : null,
      p95Px: Math.round(p95Px * 100) / 100,
      p95Deg: geom ? Math.round(degHelper(p95Px) * 100) / 100 : null,
      errorsX: { mean: sumDiffX / n },
      errorsY: { mean: sumDiffY / n },
    };
  }

  /**
   * Compute selection task metrics (for keyboard/phrase selection evaluation).
   * @param {Array<{target: string, selected: string|null, durationMs: number, correct: boolean}>} trials
   * @returns {object} Selection task performance
   */
  function computeSelectionMetrics(trials) {
    if (!trials || trials.length === 0) {
      return { totalTrials: 0, correct: 0, wrong: 0, missed: 0, accuracyRate: 0, meanTimeMs: 0 };
    }
    const total = trials.length;
    let correct = 0;
    let wrong = 0;
    let missed = 0;
    let correctTimeSum = 0;

    for (const t of trials) {
      if (t.correct) {
        correct++;
        correctTimeSum += t.durationMs || 0;
      } else if (t.selected === null) {
        missed++;
      } else {
        wrong++;
      }
    }

    return {
      totalTrials: total,
      correct,
      wrong,
      missed,
      accuracyRate: Math.round((correct / total) * 1000) / 10, // percentage e.g. 90.5
      meanTimeMs: correct > 0 ? Math.round(correctTimeSum / correct) : 0,
    };
  }

  /**
   * Compute false activation rate during rest period.
   * @param {number} activationCount Number of clicks/selections fired
   * @param {number} durationMs      Duration of the rest period in ms
   * @returns {number} Activations per minute
   */
  function computeFalseActivationsPerMin(activationCount, durationMs) {
    if (!durationMs || durationMs <= 0) return 0;
    const minutes = durationMs / 60000;
    return Math.round((activationCount / minutes) * 100) / 100;
  }

  const api = {
    pxToDegrees,
    computeGazeMetrics,
    computeSelectionMetrics,
    computeFalseActivationsPerMin,
  };

  root.LumiMetrics = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
