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

    // The iris-in-eye ratios above (Phase B features). What is about the eye itself
    // keeps using them under C1: the "iris at the corner" confidence check, the raw
    // ratio shown to the caregiver and the uncalibrated cursor.
    let ilx = lx, ily = ly, irx = rx, iry = ry;
    const pose = headPose(matrix);
    let [yaw, pitch, roll] = pose;
    // C1: needs the head matrix and landmark depth; without them, the Phase B features.
    const head = o.headFrame && matrix && matrix.data && irisL.z != null ? toHeadFrame(matrix, o.aspect || 16 / 9) : null;
    let inHeadFrame = false;
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
        inHeadFrame = true;
      }
    }

    // Honour the active-eye preference and substitute for a closed eye so the
    // feature vector is always complete (single-eye patients keep working).
    const useL = lGaze && (settings.activeEye === 'left' || settings.activeEye === 'both');
    const useR = rGaze && (settings.activeEye === 'right' || settings.activeEye === 'both');
    let eyeMode = 'none';
    if (useL && useR) eyeMode = 'both';
    else if (useL) { rx = lx; ry = ly; irx = ilx; iry = ily; eyeMode = 'left'; }
    else if (useR) { lx = rx; ly = ry; ilx = irx; ily = iry; eyeMode = 'right'; }
    else {
      const none = { eyeMode: 'none', earL, earR, lOpen, rOpen };
      // C2: open by the alarm threshold, but too narrow to give a gaze point.
      if (o.earFloor) none.narrow = (lOpen || rOpen) && !(lGaze || rGaze);
      return none;
    }

    const ear = (earL + earR) / 2;
    let faceScale, ipd;
    if (inHeadFrame) {
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
      rawRatios: { x: (ilx + irx) / 2, y: (ily + iry) / 2 },
    };
    if (inHeadFrame) {
      // C1: the angles left the features, and the eye features are no longer the
      // in-eye ratio; both are kept for confidence().
      result.pose = pose;
      result.inEye = [ilx, ily];
    }
    return result;
  }

  /**
   * How far the frame can be trusted (1 = fully); below 0.2 it gives no gaze point.
   * @param {object} [opts]  softEar (C2): confidence rises gradually above the EAR floor
   *   instead of halving below 0.12
   * @param {object} [fx]  the extract() result: under C1 its `pose` and `inEye` are used,
   *   because the features no longer hold the head angles or the iris-in-eye ratio
   */
  function confidence(features, opts, fx) {
    const o = opts || NO_OPTIONS;
    const pose = fx && fx.pose, inEye = fx && fx.inEye;
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
    const lx = inEye ? inEye[0] : features[0], ly = inEye ? inEye[1] : features[1];
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

  // ── Phase C (C1): a live check of the head-turn gain and sign ───────
  // C1 adds back gain · sin(head angle) to the eye features (see extract). The gain, 0.4, and the
  // sign, +, are assumptions about a real camera that only a real head can confirm. With the eyes held
  // on ONE point while the head turns and nods, the head-frame features (before the add-back) should
  // move by −gain per unit sin(angle), and the compensated features then stay put. These functions
  // only measure; LumiGaze.debugHeadComp() feeds them from the camera. The gaze pipeline uses none of them.
  const HEAD_COMP = { minFrames: 30, minSwingDeg: 8, minR2: 0.2, minGain: 0.15 };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const signed = (v, digits = 2) => (v >= 0 ? '+' : '') + v.toFixed(digits);

  /**
   * One frame's four eye features [lx, ly, rx, ry], measured three ways from the same landmarks:
   *   image: Phase B's iris-in-eye ratio;
   *   head:  C1's head-frame ratio, before the head turn and nod are added back;
   *   comp:  C1's feature as the model would see it (head + gain · sin(angle)).
   * Null when the frame has no usable eye (as the live engine judges it) or no head matrix or
   * landmark depth, where C1 itself falls back to `image`.
   * @param {object} [opts]  the feature options the live engine uses (aspect, earFloor, …);
   *   headFrame is replaced, and headGain is the gain of `comp` (default: the gain C1 uses)
   */
  function headCompFrame(lm, matrix, settings, opts) {
    const o = opts || NO_OPTIONS;
    const gain = o.headGain != null ? o.headGain : improvementOptions(flags(['C1'])).features.headGain;
    const image = extract(lm, matrix, settings, { ...o, headFrame: false, headGain: 0 });
    const head = extract(lm, matrix, settings, { ...o, headFrame: true, headGain: 0 });
    const comp = extract(lm, matrix, settings, { ...o, headFrame: true, headGain: gain });
    if (!image.features || !head.features || !comp.features || !head.pose) return null;
    return {
      yaw: head.pose[0], pitch: head.pose[1],
      image: image.features.slice(0, 4), head: head.features.slice(0, 4), comp: comp.features.slice(0, 4),
    };
  }

  /** Least squares of y on one or two regressors fitted together: the slopes, and the share of y's variance they explain. */
  function fitSlopes(regressors, y) {
    const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
    const centred = (a) => { const m = mean(a); return a.map((v) => v - m); };
    const xs = regressors.map(centred), yc = centred(y);
    const sxy = xs.map((x) => dot(x, yc)), syy = dot(yc, yc);
    let slopes = xs.map((x, i) => sxy[i] / dot(x, x));
    let explained = Math.max(...slopes.map((k, i) => k * sxy[i]));
    if (xs.length === 2) {
      const a = dot(xs[0], xs[0]), b = dot(xs[0], xs[1]), c = dot(xs[1], xs[1]), det = a * c - b * b;
      // If the two angles moved as one they cannot be told apart, and each keeps its own fit.
      if (det > 1e-9 * a * c) {
        slopes = [(c * sxy[0] - b * sxy[1]) / det, (a * sxy[1] - b * sxy[0]) / det];
        explained = slopes[0] * sxy[0] + slopes[1] * sxy[1];
      }
    }
    return { slopes, r2: syy > 0 ? Math.min(1, explained / syy) : 0 };
  }

  /**
   * What a run of headCompFrame() results says about C1's sign and gain. Per axis (x: the head turn,
   * against lx and rx; y: the nod, against ly and ry) it fits how much each measurement changes per
   * unit sin(angle), fitting the two angles together if both moved. `gainWanted` is the gain that would
   * cancel the head-frame feature: negative means the compensation has the wrong sign.
   * @param {object[]} frames  headCompFrame() results
   * @param {{gain?: number}} [opts]  the gain `comp` was measured with
   * @returns {{frames: number, gain: number, x: object, y: object}} each axis has a `verdict`:
   *   'sign-ok' | 'sign-wrong' | 'weak' (the feature hardly follows the angle) | 'not-moved' | 'too-few-frames'
   */
  function headCompSummary(frames, opts) {
    const gain = opts && opts.gain != null ? opts.gain : improvementOptions(flags(['C1'])).features.headGain;
    const n = frames.length;
    const swing = (key) => {
      let lo = Infinity, hi = -Infinity;
      for (const f of frames) { lo = Math.min(lo, f[key]); hi = Math.max(hi, f[key]); }
      return n ? hi - lo : 0;
    };
    const swings = { yaw: swing('yaw'), pitch: swing('pitch') };
    const used = ['yaw', 'pitch'].filter((k) => n >= HEAD_COMP.minFrames && swings[k] >= HEAD_COMP.minSwingDeg);
    const sines = used.map((k) => frames.map((f) => Math.sin((f[k] * Math.PI) / 180)));

    const axis = (key, columns) => {
      const swingDeg = swings[key];
      if (n < HEAD_COMP.minFrames) return { verdict: 'too-few-frames', swingDeg };
      const at = used.indexOf(key);
      if (at < 0) return { verdict: 'not-moved', swingDeg };
      const fit = (variant) => columns.map((c) => fitSlopes(sines, frames.map((f) => f[variant][c])));
      const slope = (fits) => mean(fits.map((r) => r.slopes[at]));
      const head = fit('head');
      const headSlope = slope(head), r2 = mean(head.map((r) => r.r2));
      const gainWanted = -headSlope;
      const verdict = r2 < HEAD_COMP.minR2 ? 'weak'
        : gainWanted >= HEAD_COMP.minGain ? 'sign-ok'
        : gainWanted <= -HEAD_COMP.minGain ? 'sign-wrong' : 'weak';
      return { verdict, swingDeg, imageSlope: slope(fit('image')), headSlope, compSlope: slope(fit('comp')), gainWanted, r2 };
    };
    return { frames: n, gain, x: axis('yaw', [0, 2]), y: axis('pitch', [1, 3]) };
  }

  const HEAD_COMP_ENDED = {
    stopped: 'stopped by you',
    interrupted: 'a calibration or an evaluation recording started',
    timeout: 'no camera frames arrived',
    error: 'the check failed, see the console',
  };

  /** The lines the console helper prints at the end: a headCompSummary() plus, optionally, reason, seconds and skipped. */
  function headCompReport(s) {
    const out = [`Head-compensation check: ${s.frames} frames${s.seconds != null ? ` in ${s.seconds.toFixed(1)} s` : ''}`
      + `${s.skipped ? `, ${s.skipped} skipped (no head matrix, landmark depth or open eye)` : ''}; gain tried ${s.gain.toFixed(2)}.`];
    if (s.reason && s.reason !== 'done') out.push(`Ended early: ${HEAD_COMP_ENDED[s.reason] || s.reason}.`);
    out.push('Slopes are eye widths per unit sin(angle). With the right sign and gain, "comp" is about 0.');
    for (const [a, label] of [[s.x, 'head turn (yaw)  '], [s.y, 'head nod (pitch) ']]) {
      if (a.verdict === 'too-few-frames') {
        out.push(`${label}: too few frames (${s.frames}) to judge; at least ${HEAD_COMP.minFrames} are needed.`);
      } else if (a.verdict === 'not-moved') {
        out.push(`${label}: the head moved ${a.swingDeg.toFixed(0)}° peak to peak; at least ${HEAD_COMP.minSwingDeg}° is needed, ±15–20° is better.`);
      } else {
        out.push(`${label}: image ${signed(a.imageSlope)}  head-frame ${signed(a.headSlope)}  comp ${signed(a.compSlope)}  R² ${a.r2.toFixed(2)}`);
        if (a.verdict === 'sign-ok') {
          const off = Math.round((s.gain / a.gainWanted - 1) * 100);
          out.push(`    sign OK. The data wants gain ${signed(a.gainWanted)}; the ${s.gain.toFixed(2)} in use is ${Math.abs(off)}% ${off >= 0 ? 'high' : 'low'}.`);
        } else if (a.verdict === 'sign-wrong') {
          out.push(`    SIGN WRONG. The head-frame feature moves the other way (the data wants gain ${signed(a.gainWanted)}), so adding ${signed(s.gain)}·sin(angle) makes it worse.`);
        } else {
          out.push(`    inconclusive: the head-frame feature hardly follows the head angle (gain wanted ${signed(a.gainWanted)}, R² ${a.r2.toFixed(2)}). Keep your eyes on one point and move your head more.`);
        }
      }
    }
    return out;
  }

  /** One live line: the head angles, and the change of each measurement (lx ly rx ry) against the first frame. */
  function headCompLine(rec) {
    const cols = (v) => v.map((x) => signed(x, 3)).join(' ');
    return `yaw ${signed(rec.yaw, 1)}° pitch ${signed(rec.pitch, 1)}° | Δimage ${cols(rec.delta.image)} | Δhead ${cols(rec.delta.head)} | Δcomp ${cols(rec.delta.comp)}`;
  }

  const api = { FEATURE_DIM, EYES, RECORD_INDICES, dist, headPose, extract, confidence,
                smoothConfidence, dwellScale, pack, unpack, IMPROVEMENTS, flags, improvementOptions,
                headCompFrame, headCompSummary, headCompReport, headCompLine };
  root.GazeFeatures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
