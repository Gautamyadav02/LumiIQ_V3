'use strict';
/**
 * Builds a MediaPipe-style 478-point face mesh containing only the landmarks
 * the gaze engine reads (eye corners, eyelids, iris centres), placed to give
 * a chosen iris position and eye opening. Coordinates are normalised (0..1).
 *
 *   irisX, irisY  iris position inside the eye (0..1), i.e. features lx/ly/rx/ry
 *   openL, openR  eye aspect ratio (EAR) of the image-left / image-right eye;
 *                 the engine treats an eye as closed below `earThreshold` (0.18)
 */
function faceLandmarks({ irisX = 0.5, irisY = 0.5, openL = 0.3, openR = 0.3 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const HALF_WIDTH = 0.03;
  const EYE_Y = 0.45;
  // corners a (image-left) and b (image-right), lids top/bottom, iris centre
  function eye(a, b, top, bottom, iris, cx, ear) {
    const opening = ear * 2 * HALF_WIDTH;          // EAR = opening / eye width
    lm[a] = { x: cx - HALF_WIDTH, y: EYE_Y, z: 0 };
    lm[b] = { x: cx + HALF_WIDTH, y: EYE_Y, z: 0 };
    lm[top] = { x: cx, y: EYE_Y - opening / 2, z: 0 };
    lm[bottom] = { x: cx, y: EYE_Y + opening / 2, z: 0 };
    lm[iris] = { x: cx - HALF_WIDTH + irisX * 2 * HALF_WIDTH, y: EYE_Y - opening / 2 + irisY * opening, z: 0 };
  }
  eye(33, 133, 159, 145, 468, 0.40, openL);   // image-left eye (the subject's right)
  eye(362, 263, 386, 374, 473, 0.60, openR);  // image-right eye (the subject's left)
  return lm;
}

/** Head facing the camera: yaw = pitch = roll = 0. */
const FACING_CAMERA = { data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

module.exports = { faceLandmarks, FACING_CAMERA };
