/**
 * LumiIQ Gaze Engine V3 — test suite (runs under JavaScriptCore `jsc`).
 *
 *   jsc gaze/test_gaze.js      (run from the repository root)
 *
 * These are real, deterministic unit tests for the math and control logic that
 * the gaze engine depends on. The MediaPipe/camera layer can only be exercised
 * in a browser, but everything below the camera is validated here.
 */

// Runs under both JavaScriptCore (load/print) and Node (require/console), so
// the same file serves local runs and CI.
if (typeof print === 'undefined') globalThis.print = console.log;
if (typeof load === 'undefined') {
  // Like jsc's load(): run the file as a script in the global scope.
  const fs = require('fs');
  const vm = require('vm');
  globalThis.load = function (p) { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); };
}
if (typeof console === 'undefined') globalThis.console = { log: print, warn: print, error: print };

load('gaze/one-euro-filter.js');
load('gaze/ridge-regression.js');
load('gaze/gaze-stabilizer.js');
load('gaze/dwell-controller.js');
load('gaze/gaze-calibration.js');
load('gaze/drift-detector.js');

var passed = 0;
var failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; print('  PASS  ' + name); }
  else { failed++; print('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// Deterministic PRNG so tests are reproducible.
var _seed = 12345;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function noise(s) { return (rnd() - 0.5) * 2 * s; }

print('\n=== PolynomialFeatures ===');
(function () {
  var pf = new PolynomialFeatures(2);
  var out = pf.transform([2, 3]);
  // degree1: 2,3 ; degree2 (i<=j): 2*2=4, 2*3=6, 3*3=9
  ok('degree-2 expansion length', out.length === 5, JSON.stringify(out));
  ok('degree-2 values', JSON.stringify(out) === JSON.stringify([2, 3, 4, 6, 9]), JSON.stringify(out));
  ok('degree-1 length', new PolynomialFeatures(1).transform([1, 2, 3]).length === 3);
})();

print('\n=== solveLinearSystem ===');
(function () {
  // 2x+y=5 ; x-y=1  -> x=2,y=1
  var x = GazeRegressionMath.solveLinearSystem([[2, 1], [1, -1]], [5, 1]);
  ok('solves 2x2', approx(x[0], 2, 1e-9) && approx(x[1], 1, 1e-9), JSON.stringify(x));
})();

print('\n=== RidgeRegressor recovers a known map ===');
(function () {
  function truth(f) { return 0.2 + 0.6 * f[0] + 0.1 * f[1] - 0.15 * f[0] * f[1] + 0.2 * f[0] * f[0]; }
  var X = [], y = [];
  for (var i = 0; i < 200; i++) { var f = [rnd(), rnd()]; X.push(f); y.push(truth(f) + noise(0.01)); }
  var sel = GazeRegressionMath.selectLambda(X, y, 2);
  var m = new RidgeRegressor({ degree: 2, lambda: sel.lambda }).fit(X, y);
  var cv = GazeRegressionMath.crossValR2(X, y, { degree: 2, lambda: sel.lambda });
  ok('cross-val R^2 > 0.97', cv.r2 > 0.97, 'r2=' + cv.r2.toFixed(4));
  var tf = [0.5, 0.5];
  ok('prediction near truth', approx(m.predictRow(tf), truth(tf), 0.03), 'pred=' + m.predictRow(tf).toFixed(4) + ' truth=' + truth(tf).toFixed(4));

  // Serialization round-trip predicts identically.
  var clone = RidgeRegressor.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  ok('serialize/deserialize identical', approx(clone.predictRow(tf), m.predictRow(tf), 1e-9));
})();

print('\n=== crossValR2 rejects pure noise ===');
(function () {
  var X = [], y = [];
  for (var i = 0; i < 120; i++) { X.push([rnd(), rnd()]); y.push(rnd()); }
  var cv = GazeRegressionMath.crossValR2(X, y, { degree: 2, lambda: 1.0 });
  ok('noise R^2 < 0.3', cv.r2 < 0.3, 'r2=' + cv.r2.toFixed(4));
})();

print('\n=== OneEuroFilter ===');
(function () {
  var f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007 });
  var rawErr = 0, filtErr = 0, n = 0, t = 0;
  for (var i = 0; i < 400; i++) {
    t += 16.7;
    var raw = 0.5 + noise(0.05);
    var fv = f.filter(raw, t);
    if (i > 80) { rawErr += Math.abs(raw - 0.5); filtErr += Math.abs(fv - 0.5); n++; }
  }
  ok('reduces jitter on steady signal', filtErr < rawErr * 0.6, 'raw=' + (rawErr / n).toFixed(4) + ' filt=' + (filtErr / n).toFixed(4));

  // Step response: should converge near the new value (responsive, not stuck).
  var f2 = new OneEuroFilter({ minCutoff: 1.0, beta: 0.02 });
  var tt = 0, v = 0;
  for (var j = 0; j < 60; j++) { tt += 16.7; v = f2.filter(1.0, tt); }
  ok('tracks a step (responsive)', v > 0.9, 'converged=' + v.toFixed(3));
})();

print('\n=== GazeStabilizer deadband ===');
(function () {
  var s = new GazeStabilizer({ deadband: 4, width: 1000, height: 1000, minCutoff: 5, beta: 0.05 });
  var t = 0, a, b;
  for (var i = 0; i < 30; i++) { t += 16; a = s.process(500 + noise(1.0), 500 + noise(1.0), t); }
  // After settling, tiny sub-deadband jitter should hold the cursor still.
  var p1 = s.process(500.5, 500.5, t + 16);
  var p2 = s.process(501.0, 500.0, t + 32);
  ok('holds still within deadband', p1.x === p2.x && p1.y === p2.y, JSON.stringify(p1) + JSON.stringify(p2));
  // A large move escapes the deadband.
  var p3 = s.process(800, 200, t + 200);
  ok('follows a large move', Math.abs(p3.x - p1.x) > 50, JSON.stringify(p3));
  ok('clamps to bounds', s.process(99999, -99999, t + 400).x === 1000);
})();

print('\n=== DwellController ===');
(function () {
  function makeHit(rect) { return function (x, y) { return (x >= rect[0] && x <= rect[1]) ? 'A' : null; }; }
  // 1) Steady gaze fires exactly once.
  var fires = 0;
  var d = new DwellController({
    dwellTime: 800, focusTime: 120, cooldown: 500, adaptive: true,
    hitTest: makeHit([100, 300]),
    onActivate: function () { fires++; },
  });
  var t = 0;
  for (var i = 0; i < 120; i++) { t += 16; d.update(150 + noise(2), 150 + noise(2), t); } // ~1.9s steady
  ok('steady gaze fires once', fires === 1, 'fires=' + fires);

  // 2) Leaving mid-dwell cancels (no fire).
  var fires2 = 0;
  var d2 = new DwellController({
    dwellTime: 800, focusTime: 120, cooldown: 500,
    hitTest: makeHit([100, 300]),
    onActivate: function () { fires2++; },
  });
  var t2 = 0;
  for (var k = 0; k < 20; k++) { t2 += 16; d2.update(150, 150, t2); } // ~0.32s, mid-dwell
  for (var m = 0; m < 20; m++) { t2 += 16; d2.update(900, 150, t2); } // off-target
  ok('leaving mid-dwell cancels', fires2 === 0, 'fires=' + fires2);

  // 3) Unstable gaze (exceeds focusRadius every frame) never dwells.
  var fires3 = 0;
  var d3 = new DwellController({
    dwellTime: 600, focusTime: 120, focusRadius: 40, cooldown: 500,
    hitTest: makeHit([0, 1000]),
    onActivate: function () { fires3++; },
  });
  var t3 = 0;
  for (var q = 0; q < 120; q++) { t3 += 16; d3.update(q % 2 === 0 ? 100 : 300, 150, t3); }
  ok('unstable gaze never fires', fires3 === 0, 'fires=' + fires3);

  // 4) Progress is reported and monotonic during an uninterrupted dwell.
  var maxP = 0, sawProgress = false;
  var d4 = new DwellController({
    dwellTime: 800, focusTime: 100, cooldown: 500, adaptive: false,
    hitTest: makeHit([0, 1000]),
    onProgress: function (tgt, p) { if (p > 0) sawProgress = true; maxP = Math.max(maxP, p); },
  });
  var t4 = 0;
  for (var r = 0; r < 70; r++) { t4 += 16; d4.update(500, 500, t4); }
  ok('progress reported & reaches 1.0', sawProgress && approx(maxP, 1.0, 0.001), 'maxP=' + maxP.toFixed(3));
})();

print('\n=== GazeCalibration layouts ===');
(function () {
  ok('5-point layout', GazeCalibration.buildLayout(5).length === 5);
  ok('9-point layout', GazeCalibration.buildLayout(9).length === 9);
  ok('16-point layout', GazeCalibration.buildLayout(16).length === 16);
  ok('25-point layout', GazeCalibration.buildLayout(25).length === 25);
  var allIn = GazeCalibration.buildLayout(25).every(function (p) {
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  });
  ok('targets within [0,1]', allIn);
})();

print('\n=== GazeCalibration end-to-end (synthetic eye) ===');
(function () {
  // A synthetic "true" gaze model: 8 features -> normalized screen (x,y).
  // Features: [lx, ly, rx, ry, yaw, pitch, roll, ear]. We make screen mostly a
  // function of horizontal iris ratios (x) and vertical iris ratios (y), with a
  // small head-pose influence and mild non-linearity — like a real eye.
  function eyeFeatures(sx, sy) {
    // Invert a plausible forward model to synthesize iris features for a target.
    var lx = 0.5 + (sx - 0.5) * 0.7 + noise(0.01);
    var rx = 0.5 + (sx - 0.5) * 0.72 + noise(0.01);
    var ly = 0.5 + (sy - 0.5) * 0.6 + noise(0.01);
    var ry = 0.5 + (sy - 0.5) * 0.61 + noise(0.01);
    var yaw = (sx - 0.5) * 6 + noise(0.3);
    var pitch = (sy - 0.5) * 5 + noise(0.3);
    var roll = noise(0.5);
    var ear = 0.32 + noise(0.01);
    return [lx, ly, rx, ry, yaw, pitch, roll, ear];
  }

  var cal = new GazeCalibration({ maxSamplesPerPoint: 24 });
  var target = cal.begin(9);
  var totalRejected = 0;
  while (target) {
    // Collect ~35 frames per target, with occasional blink/garbage outliers.
    for (var i = 0; i < 35; i++) {
      if (i === 10 || i === 22) {
        cal.addSample([rnd(), rnd(), rnd(), rnd(), 40, 40, 40, 0.05]); // blink/garbage
      } else {
        cal.addSample(eyeFeatures(target.x, target.y));
      }
    }
    var res = cal.commitPoint();
    totalRejected += res.rejected;
    target = res.next;
  }
  ok('rejected blink/garbage outliers', totalRejected >= 9, 'rejected=' + totalRejected);

  var report = cal.train({ width: 1440, height: 900 });
  print('  report: ' + JSON.stringify(report));
  ok('training succeeded', report.ok === true);
  ok('quality at least Good', report.r2 >= 0.8, 'r2=' + report.r2.toFixed(4) + ' rating=' + report.rating);
  ok('pixel accuracy is finite & reasonable', report.accuracyPx > 0 && report.accuracyPx < 200, 'px=' + report.accuracyPx);

  // Prediction accuracy at fresh targets.
  var err = 0, m = 0;
  var checks = [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8], [0.2, 0.8], [0.8, 0.2]];
  for (var c = 0; c < checks.length; c++) {
    var p = cal.predict(eyeFeatures(checks[c][0], checks[c][1]));
    err += Math.hypot(p.x - checks[c][0], p.y - checks[c][1]);
    m++;
  }
  ok('mean normalized prediction error < 0.08', err / m < 0.08, 'err=' + (err / m).toFixed(4));

  // Persisted calibration predicts identically.
  var restored = GazeCalibration.fromJSON(JSON.parse(JSON.stringify(cal.toJSON())));
  var f = eyeFeatures(0.5, 0.5);
  var a = cal.predict(f), b = restored.predict(f);
  ok('persisted calibration predicts identically', approx(a.x, b.x, 1e-9) && approx(a.y, b.y, 1e-9));
})();

print('\n=== DriftDetector ===');
(function () {
  var d = new DriftDetector();
  var flagged = false;
  for (var i = 0; i < 20; i++) {
    flagged = d.onDwellActivate({ x: 100, y: 100 }, { x: 100, y: 100 }, { width: 100, height: 100 });
  }
  ok('accurate dwells never ask for recalibration', flagged === false);

  var d2 = new DriftDetector();
  var flagged2 = false;
  for (var j = 0; j < 15; j++) {
    // 70px off a 100px target → 0.7 normalized error, past the 0.6 threshold.
    flagged2 = d2.onDwellActivate({ x: 170, y: 100 }, { x: 100, y: 100 }, { width: 100, height: 100 });
  }
  ok('sustained drift asks for recalibration', flagged2 === true);
})();

print('\n=== DwellController accepts non-DOM targets ===');
(function () {
  // The controller documents itself as UI-agnostic; a plain token must work.
  var fired = 0;
  var d = new DwellController({
    dwellTime: 600, focusTime: 100, cooldown: 500,
    hitTest: function () { return 'token'; },
    onActivate: function () { fired++; },
  });
  var t = 0;
  for (var i = 0; i < 80; i++) { t += 16; d.update(400, 400, t); }
  ok('fires on a target with no geometry', fired === 1, 'fires=' + fired);

  // A target far wider than cancelRadius must still be clickable from its edge.
  var wideFired = 0;
  var wide = new DwellController({
    dwellTime: 600, focusTime: 100, cancelRadius: 90, cooldown: 500,
    hitTest: function (x) { return (x >= 0 && x <= 800) ? 'wide' : null; },
    onActivate: function () { wideFired++; },
  });
  var t2 = 0;
  // Gaze parked near the left edge of an 800px-wide target (centre is 400px away).
  for (var k = 0; k < 80; k++) { t2 += 16; wide.update(40, 300, t2); }
  ok('wide target fires from its edge', wideFired === 1, 'fires=' + wideFired);
})();

print('\n================ ' + passed + ' passed, ' + failed + ' failed ================\n');
if (failed > 0) throw new Error(failed + ' test(s) failed');
