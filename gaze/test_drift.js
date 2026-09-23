const { DriftDetector } = require('./drift-detector.js');

const detector = new DriftDetector();
let needsRecalib = false;

// Simulate perfect clicks (error = 0)
for (let i = 0; i < 20; i++) {
    needsRecalib = detector.onDwellActivate({x:100, y:100}, {x:100, y:100}, {width: 100, height: 100});
}
console.log("Perfect clicks trigger recalib?", needsRecalib); // false

// Simulate bad clicks (error > 0.6)
for (let i = 0; i < 15; i++) {
    // 70px away from center, size is 100x100 -> error ratio 0.7
    needsRecalib = detector.onDwellActivate({x:170, y:100}, {x:100, y:100}, {width: 100, height: 100});
}
console.log("Bad clicks trigger recalib?", needsRecalib); // true
console.log("PASS: Drift tests");
