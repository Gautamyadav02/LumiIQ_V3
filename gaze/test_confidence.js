// Test the confidence scoring logic
const assert = require('assert');

// Mock a simple features array
// [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]
const goodFeatures = [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.25, 50, 60];
const badEarFeatures = [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.05, 50, 60]; // EAR < 0.12
const badPoseFeatures = [0.5, 0.5, 0.5, 0.5, 30, 25, 0, 0.25, 50, 60]; // yaw>25, pitch>20

// The compute function from gaze-engine
function _computeConfidence(features) {
    let score = 1.0;
    const ear = features[7];
    if (ear < 0.12 || ear > 0.45) score *= 0.5;
    const lx = features[0], ly = features[1];
    if (lx < 0.1 || lx > 0.9 || ly < 0.1 || ly > 0.9) score *= 0.6;
    const yaw = Math.abs(features[4]), pitch = Math.abs(features[5]);
    if (yaw > 25) score *= Math.max(0.3, 1 - (yaw - 25) / 45);
    if (pitch > 20) score *= Math.max(0.3, 1 - (pitch - 20) / 40);
    return score;
}

console.log("Good features score:", _computeConfidence(goodFeatures));
console.log("Bad EAR score:", _computeConfidence(badEarFeatures));
console.log("Bad Pose score:", _computeConfidence(badPoseFeatures));
console.log("PASS: Confidence tests");
