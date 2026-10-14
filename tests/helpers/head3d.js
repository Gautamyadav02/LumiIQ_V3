'use strict';
/**
 * A synthetic 3-D head for the Phase C head-pose tests. SYNTHETIC: it follows a
 * simple geometric model, and a real head is not guaranteed to.
 *
 * Model:
 *   • Two eyes, each with two corners and two eyelids in the head's own frame,
 *     and an iris on a rigid eyeball that rotates about a centre behind the
 *     eye-corner plane (radius = eyeballRatio × eye width).
 *   • The head turns (yaw), nods (pitch) and tilts (roll) as a rigid body.
 *   • To look at a screen point, the gaze direction is "head angle + eye angle":
 *     when the head turns, the eyes counter-rotate to keep looking at the same point.
 *
 * Output: MediaPipe-style normalised landmarks (x right, y down, z away from the
 * camera, scaled like x) and the column-major 4×4 head matrix, as the engine gets them.
 * Frames: head frame = camera frame when facing the camera, in units of the image
 * height: x right in the image, y up, z towards the camera.
 */
const F = require('../../gaze/gaze-features.js');

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
}

const rad = (deg) => (deg * Math.PI) / 180;

/** R = Rz(roll) · Ry(yaw) · Rx(pitch): the order gaze-features.js's headPose() decomposes. */
function rotation(yaw, pitch, roll) {
  const [a, b, c] = [rad(yaw), rad(pitch), rad(roll)];
  const Rx = [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
  const Ry = [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
  const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
  return mul(Rz, mul(Ry, Rx));
}

/**
 * @param {object} [o]
 * @param {number} [o.eyeWidth=0.05]      corner to corner, in image heights
 * @param {number} [o.eyeballRatio=0.34]  rotation radius ÷ eye width (the compensation assumes 0.4)
 * @param {number} [o.aspect=16/9]        camera image width ÷ height
 * @param {number} [o.distanceCm=60], [o.screenWidthCm=30], [o.screenHeightCm=19]
 */
function makeHead({ eyeWidth = 0.05, eyeballRatio = 0.34, interEye = 0.12, ear = 0.3, aspect = 16 / 9,
                    distanceCm = 60, screenWidthCm = 30, screenHeightCm = 19 } = {}) {
  const w = eyeWidth, R = eyeballRatio * eyeWidth, open = ear * eyeWidth;
  const eyes = [
    { centre: -interEye / 2, idx: { a: 33, b: 133, top: 159, bottom: 145, iris: 468 } },   // the patient's right eye
    { centre: interEye / 2, idx: { a: 362, b: 263, top: 386, bottom: 374, iris: 473 } },   // the patient's left eye
  ];

  /** The gaze angles (degrees; + = towards image right / downwards) to look at a screen point. */
  function gazeAngles(target) {
    return {
      h: Math.atan(((0.5 - target.x) * screenWidthCm) / distanceCm) * 180 / Math.PI,
      v: Math.atan(((target.y - 0.5) * screenHeightCm) / distanceCm) * 180 / Math.PI,
    };
  }

  /**
   * One camera frame of a person looking at `target` (normalised screen point).
   * @returns {{lm: object[], matrix: {data: number[]}}}
   */
  function frame({ target, yaw = 0, pitch = 0, roll = 0, noise = 0, rand = Math.random }) {
    const g = gazeAngles(target);
    const eyeH = rad(g.h - yaw), eyeV = rad(g.v - pitch);           // the eyes make up the rest
    const head = {};
    for (const e of eyes) {
      const cx = e.centre;
      head[e.idx.a] = [cx - w / 2, 0, 0];
      head[e.idx.b] = [cx + w / 2, 0, 0];
      head[e.idx.top] = [cx, open / 2, 0];
      head[e.idx.bottom] = [cx, -open / 2, 0];
      // Iris on the eyeball: rotation centre R behind the corner plane.
      head[e.idx.iris] = [cx + R * Math.sin(eyeH) * Math.cos(eyeV), -R * Math.sin(eyeV), -R + R * Math.cos(eyeH) * Math.cos(eyeV)];
    }
    Object.assign(head, { 1: [0, -0.06, 0.04], 168: [0, 0.01, 0.02], 10: [0, 0.12, 0], 152: [0, -0.16, 0], 234: [-0.13, -0.02, -0.06], 454: [0.13, -0.02, -0.06] });
    const M = rotation(yaw, pitch, roll);
    const lm = [];
    for (const [i, p] of Object.entries(head)) {
      const P = [0, 1, 2].map((r) => M[r][0] * p[0] + M[r][1] * p[1] + M[r][2] * p[2]);
      lm[i] = { x: P[0] / aspect + 0.5 + rand() * noise, y: 0.5 - P[1] + rand() * noise, z: -P[2] / aspect + rand() * noise };
    }
    const data = [M[0][0], M[1][0], M[2][0], 0, M[0][1], M[1][1], M[2][1], 0, M[0][2], M[1][2], M[2][2], 0, 0, 0, 0, 1];
    return { lm, matrix: { data } };
  }

  return { frame, gazeAngles, aspect };
}

module.exports = { makeHead, rotation, rng, F };
