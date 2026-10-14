/**
 * LumiIQ Gaze Engine V3 — Feature extraction
 *
 * Turns MediaPipe face landmarks into the regression feature vector
 *
 *     [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]
 *
 * plus the eye open/closed state and a confidence score. It is a pure module
 * (no DOM, no camera) so that the live engine (gaze-engine.js) and the offline
 * replay of recorded sessions (eval/replay.js) run exactly the same code.
 *
 * `lm` is MediaPipe's landmark list: an array indexed by landmark number whose
 * entries have x, y (normalised image coordinates) and optionally z. Only the
 * landmarks in RECORD_INDICES are read, so a sparse array works too (unpack()).
 */
(function (root) {
  'use strict';

  const FEATURE_DIM = 10;

  // The landmarks of each eye, in MediaPipe's naming, which is the patient's own
  // side for an unmirrored camera image. The engine's "L" features (lx, earL,
  // activeEye 'left') come from the first entry unless swapEyes is on.
  const EYES = [
    { side: 'right', iris: 468, corners: [33, 133], lids: [159, 145] },
    { side: 'left', iris: 473, corners: [362, 263], lids: [386, 374] },
  ];

  // What an evaluation session stores per frame: the ten eye landmarks the
  // features are built from, then six rigid reference points of the face (nose
  // tip, between the eyes, forehead, chin, both sides) for head-pose studies.
  const RECORD_INDICES = [33, 133, 159, 145, 362, 263, 386, 374, 468, 473, 1, 168, 10, 152, 234, 454];

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /** Head pose (yaw, pitch, roll in degrees) from MediaPipe's 4×4 transform. */
  function headPose(matrix) {
    if (!matrix || !matrix.data) return [0, 0, 0];
    const m = matrix.data; // column-major 4×4
    const R = (r, c) => m[c * 4 + r];
    const sy = Math.hypot(R(0, 0), R(1, 0));
    let x, y, z;
    if (sy > 1e-6) {
      x = Math.atan2(R(2, 1), R(2, 2));
      y = Math.atan2(-R(2, 0), sy);
      z = Math.atan2(R(1, 0), R(0, 0));
    } else {
      x = Math.atan2(-R(1, 2), R(1, 1));
      y = Math.atan2(-R(2, 0), sy);
      z = 0;
    }
    const deg = 180 / Math.PI;
    return [y * deg, x * deg, z * deg]; // [yaw, pitch, roll]
  }

  /** The 3×3 rotation of MediaPipe's column-major 4×4 matrix, as R(row, col). */
  function rotationOf(matrix) {
    const m = matrix.data;
    return (r, c) => m[c * 4 + r];
  }

  /**
   * Phase C (C1): a function taking a landmark into the head's own frame.
   * Landmarks are normalised (x by the image width, y by the height, z like x),
   * so they are first made isotropic (units of the image height, y up, z towards
   * the camera), then rotated back by the head's rotation: p = Rᵀ · P.
   * Only differences between points are used, so the translation cancels.
   */
  function toHeadFrame(matrix, aspect) {
    const R = rotationOf(matrix);
    return (p) => {
      const X = p.x * aspect, Y = -p.y, Z = -(p.z || 0) * aspect;
      return {
        x: R(0, 0) * X + R(1, 0) * Y + R(2, 0) * Z,
        y: R(0, 1) * X + R(1, 1) * Y + R(2, 1) * Z,
        z: R(0, 2) * X + R(1, 2) * Y + R(2, 2) * Z,
      };
    };
  }

  /**
   * Phase C (C1): where the iris sits in the eye, in the head's frame.
   *   x: along the corner-to-corner line, 0 at the first corner, 1 at the second;
   *   y: below the corner line, in eye widths, plus 0.5 (so "straight ahead" ≈ 0.5).
   * Using the corners rather than the eyelids, the vertical feature no longer
   * moves when the eyelids do (Phase A found it did).
   */
  function headFrameRatio(head, iris, a, b) {
    const I = head(iris), A = head(a), B = head(b);
    const width = B.x - A.x;
    if (Math.abs(width) < 1e-9) return null;
    return { x: (I.x - A.x) / width, y: 0.5 + ((A.y + B.y) / 2 - I.y) / Math.abs(width) };
  }

  const dist3 = (head, a, b) => { const A = head(a), B = head(b); return Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z); };
  const NO_OPTIONS = {};

  /**
   * Build the regression feature vector and blink/eye state from landmarks.
   * Without a usable eye the result has no `features` (eyeMode 'none').
   * @param {object} settings  earThreshold, activeEye ('both'|'left'|'right'), swapEyes
   * @param {object} [opts]    Phase C options (improvementOptions().features); none = Phase B:
   *   headFrame, headGain (C1): eye features in the head frame, with head turn and tilt added back;
   *   earFloor (C2): an eye must be open wider than this to be used for gaze;
   *   aspect: the camera image's width ÷ height (C1; default 16/9).
   */
  function extract(lm, matrix, settings, opts) {
    const o = opts || NO_OPTIONS;
    // Eye-aspect-ratio per eye (vertical opening / horizontal width).
    let earL = dist(lm[159], lm[145]) / (dist(lm[33], lm[133]) + 1e-6);
    let earR = dist(lm[386], lm[374]) / (dist(lm[362], lm[263]) + 1e-6);

    // Iris-within-eye ratios (0..1). Independent of head translation.
    let irisL = lm[468], irisR = lm[473];
    let L_tl = lm[33], L_tr = lm[133], L_top = lm[159], L_bot = lm[145];
    let R_tl = lm[362], R_tr = lm[263], R_top = lm[386], R_bot = lm[374];

    if (settings.swapEyes) {
      const t1 = earL; earL = earR; earR = t1;
      [irisL, irisR] = [irisR, irisL];
      [L_tl, R_tl] = [R_tl, L_tl]; [L_tr, R_tr] = [R_tr, L_tr];
      [L_top, R_top] = [R_top, L_top]; [L_bot, R_bot] = [R_bot, L_bot];
    }

    // Open/closed for blinks and the eyes-closed alarm: the caregiver's threshold.
    const lOpen = earL > settings.earThreshold;
    const rOpen = earR > settings.earThreshold;
    // Usable for gaze. C2: never below the floor, whatever the alarm threshold.
    const gazeThreshold = o.earFloor ? Math.max(settings.earThreshold, o.earFloor) : settings.earThreshold;
    const lGaze = earL > gazeThreshold;
    const rGaze = earR > gazeThreshold;

    let lx = (irisL.x - L_tl.x) / (L_tr.x - L_tl.x + 1e-6);
    let ly = (irisL.y - L_top.y) / (L_bot.y - L_top.y + 1e-6);
    let rx = (irisR.x - R_tl.x) / (R_tr.x - R_tl.x + 1e-6);
    let ry = (irisR.y - R_top.y) / (R_bot.y - R_top.y + 1e-6);

    const pose = headPose(matrix);
    let [yaw, pitch, roll] = pose;
    // C1: needs the head matrix and landmark depth; without them, the Phase B features.
    const head = o.headFrame && matrix && matrix.data && irisL.z != null ? toHeadFrame(matrix, o.aspect || 16 / 9) : null;
    if (head) {
      const left = headFrameRatio(head, irisL, L_tl, L_tr), right = headFrameRatio(head, irisR, R_tl, R_tr);
      if (left && right) {
        // Gaze direction = head angle + eye angle. A head turn of θ moves the gaze as
        // far as an iris shift of gain·sin θ eye widths (gain = eyeball radius ÷ eye
        // width, about 0.4 from eye anatomy), so it is added to the eye features and
        // the separate angle features are dropped: from a head-still calibration they
        // have almost no spread, and standardising them blew up any later head turn.
        const gain = o.headGain || 0;
        const dx = gain * Math.sin(yaw * Math.PI / 180), dy = gain * Math.sin(pitch * Math.PI / 180);
        lx = left.x + dx; ly = left.y + dy; rx = right.x + dx; ry = right.y + dy;
        yaw = 0; pitch = 0; roll = 0;
      }
    }

    // Honour the active-eye preference and substitute for a closed eye so the
    // feature vector is always complete (single-eye patients keep working).
    const useL = lGaze && (settings.activeEye === 'left' || settings.activeEye === 'both');
    const useR = rGaze && (settings.activeEye === 'right' || settings.activeEye === 'both');
    let eyeMode = 'none';
    if (useL && useR) eyeMode = 'both';
    else if (useL) { rx = lx; ry = ly; eyeMode = 'left'; }
    else if (useR) { lx = rx; ly = ry; eyeMode = 'right'; }
    else {
      const none = { eyeMode: 'none', earL, earR, lOpen, rOpen };
      // C2: open by the alarm threshold, but too narrow to give a gaze point.
      if (o.earFloor) none.narrow = (lOpen || rOpen) && !(lGaze || rGaze);
      return none;
    }

    const ear = (earL + earR) / 2;
    let faceScale, ipd;
    if (head && yaw === 0 && pitch === 0 && roll === 0) {
      // In 3-D, so that turning the head does not change them.
      faceScale = dist3(head, lm[33], lm[263]);
      ipd = dist3(head, lm[468], lm[473]);
    } else {
      // Face scale (inter-eye-corner distance, normalizes for head distance from camera)
      faceScale = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y);
      // Inter-pupillary distance (sensitive to head rotation)
      ipd = Math.hypot(lm[468].x - lm[473].x, lm[468].y - lm[473].y);
    }

    const result = {
      features: [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd],
      eyeMode, earL, earR, lOpen, rOpen,
      rawRatios: { x: (lx + rx) / 2, y: (ly + ry) / 2 },
    };
    if (head) result.pose = pose;              // C1: the angles left the features; keep them for confidence
    return result;
  }

  /**
   * How far the frame can be trusted (1 = fully); below 0.2 it gives no gaze point.
   * @param {object} [opts]  softEar (C2): confidence rises gradually above the EAR floor
   *   instead of halving below 0.12
   * @param {number[]} [pose]  [yaw, pitch, roll] when they are not in the features (C1)
   */
  function confidence(features, opts, pose) {
    const o = opts || NO_OPTIONS;
    let score = 1.0;

    // 1. EAR sanity — very low or very high EAR suggests bad detection
    const ear = features[7];
    if (o.softEar && o.earFloor) {
      const ramp = Math.max(0, Math.min(1, (ear - o.earFloor) / 0.06));
      score *= 0.5 + 0.5 * ramp;
      if (ear > 0.45) score *= 0.5;
    } else if (ear < 0.12 || ear > 0.45) {
      score *= 0.5;
    }

    // 2. Iris containment — iris center should be INSIDE eye contour
    const lx = features[0], ly = features[1];
    if (lx < 0.1 || lx > 0.9 || ly < 0.1 || ly > 0.9) score *= 0.6;

    // 3. Head pose extremes — accuracy degrades at large angles
    const yaw = Math.abs(pose ? pose[0] : features[4]), pitch = Math.abs(pose ? pose[1] : features[5]);
    if (yaw > 25) score *= Math.max(0.3, 1 - (yaw - 25) / 45);
    if (pitch > 20) score *= Math.max(0.3, 1 - (pitch - 20) / 40);

    return score;
  }

  /** Running average of confidence (starts at 1). */
  function smoothConfidence(previous, conf) {
    return (previous || 1.0) * 0.9 + conf * 0.1;
  }

  /** Dwell takes longer while the averaged confidence is low. */
  function dwellScale(avgConfidence) {
    if (avgConfidence < 0.4) return 2.0;
    if (avgConfidence < 0.7) return 1.3;
    return 1;
  }

  /** The recorded landmarks of one frame as a flat [x, y, z, x, y, z, …] list. */
  function pack(lm) {
    const out = new Array(RECORD_INDICES.length * 3);
    for (let i = 0; i < RECORD_INDICES.length; i++) {
      const p = lm[RECORD_INDICES[i]];
      out[i * 3] = p ? p.x : 0;
      out[i * 3 + 1] = p ? p.y : 0;
      out[i * 3 + 2] = p && p.z != null ? p.z : 0;
    }
    return out;
  }

  /** The reverse of pack(): a sparse landmark list that extract() can read. */
  function unpack(flat) {
    const lm = [];
    for (let i = 0; i < RECORD_INDICES.length; i++) {
      lm[RECORD_INDICES[i]] = { x: flat[i * 3], y: flat[i * 3 + 1], z: flat[i * 3 + 2] };
    }
    return lm;
  }

  // ── Phase C: candidate accuracy changes ─────────────────────────────
  // Each change has its own switch, so the offline replay can score it on its own
  // against the Phase B baseline. With every switch off the gaze code behaves
  // exactly as in Phase B. None of them is validated until recorded sessions say so.
  const IMPROVEMENTS = {
    C1: 'Head-pose compensation: eye features measured in the head\'s own frame, with head turn and tilt added back in',
    C2: 'Gaze needs an eye opening (EAR) above 0.16; confidence falls smoothly near that floor',
    C3: 'Calibration rejects a frame disturbed in 3 of its 10 features',
    C4: 'Calibration ignores samples in the first 300 ms after a target change',
    C5: 'Model degree 1 or 2, chosen per calibration by leave-one-target-out error',
    C6: 'Low-confidence frames are smoothed more',
    C7: 'Drift detector looks for a consistent directional bias',
  };

  /** Switch settings from 'all', 'none', a list such as ['C1', 'C6'], or an object. */
  function flags(which) {
    const names = Object.keys(IMPROVEMENTS);
    const on = which === 'all' ? names : which === 'none' || which == null ? []
      : Array.isArray(which) ? which : names.filter((n) => which[n] === true);
    for (const n of on) if (!IMPROVEMENTS[n]) throw new Error(`Unknown improvement "${n}" (known: ${names.join(', ')})`);
    return Object.fromEntries(names.map((n) => [n, on.includes(n)]));
  }

  /** The module options each set of switches means. */
  function improvementOptions(f) {
    return {
      features: { headFrame: !!f.C1, headGain: f.C1 ? 0.4 : 0, earFloor: f.C2 ? 0.16 : 0, softEar: !!f.C2 },
      calibration: { strictOutliers: !!f.C3, settleMs: f.C4 ? 300 : 0, degree: f.C5 ? 'auto' : 2,
                     stdFloorRatio: f.C1 ? 0.05 : 0, featureSet: f.C1 ? 'head' : 'image' },
      stabilizer: { confidenceWeighting: !!f.C6 },
      drift: { mode: f.C7 ? 'bias' : 'legacy' },
    };
  }

  const api = { FEATURE_DIM, EYES, RECORD_INDICES, dist, headPose, extract, confidence,
                smoothConfidence, dwellScale, pack, unpack, IMPROVEMENTS, flags, improvementOptions };
  root.GazeFeatures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
