// Stubbed-DOM smoke test: loads the real app files to verify they parse,
// evaluate, and that the engine is correctly wired to the V3 modules.
// Runs under jsc (`jsc gaze/_smoke.js`) and Node (`node gaze/_smoke.js`).
if (typeof print === 'undefined') globalThis.print = console.log;
if (typeof load === 'undefined') {
  // Like jsc's load(): run the file as a script in the global scope, so
  // top-level `const` globals (LumiGaze, EyeApp) stay visible.
  const fs = require('fs');
  const vm = require('vm');
  globalThis.load = function (p) { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); };
}
globalThis.addEventListener = function () {};
globalThis.window = globalThis;
globalThis.performance = { now: function () { return 0; } };
globalThis.console = globalThis.console || { log: print, warn: print, error: print };
globalThis.navigator = { mediaDevices: {} };
globalThis.document = {
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () {
    return { classList: { add() {}, remove() {}, toggle() {} }, style: {},
             appendChild() {}, addEventListener() {}, querySelector() { return null; } };
  },
  body: { appendChild: function () {} },
  elementFromPoint: function () { return null; }
};

load('gaze/one-euro-filter.js');
load('gaze/ridge-regression.js');
load('gaze/gaze-stabilizer.js');
load('gaze/dwell-controller.js');
load('gaze/gaze-calibration.js');
load('gaze-engine.js');
load('app.js');

var fail = 0;
function ok(n, c, x) { if (c) print('  PASS  ' + n); else { fail++; print('  FAIL  ' + n + (x ? ' [' + x + ']' : '')); } }

print('\n=== load & wiring ===');
ok('LumiGaze defined', typeof LumiGaze === 'object');
ok('EyeApp defined', typeof EyeApp === 'object');
ok('modules present', typeof GazeCalibration === 'function' && typeof GazeStabilizer === 'function' &&
   typeof DwellController === 'function' && typeof OneEuroFilter2D === 'function' && typeof RidgeRegressor === 'function');

print('\n=== engine pure methods ===');
// Identity transform → zero head pose.
var idm = { data: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] };
var hp = LumiGaze._headPose(idm);
ok('identity matrix → ~0 yaw/pitch/roll', Math.abs(hp[0]) < 1e-6 && Math.abs(hp[1]) < 1e-6 && Math.abs(hp[2]) < 1e-6, JSON.stringify(hp));
ok('missing matrix → [0,0,0]', JSON.stringify(LumiGaze._headPose(null)) === '[0,0,0]');

// Centered iris → centered fallback cursor.
var fb = LumiGaze._fallbackMap([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.3]);
ok('fallback centers at 0.5', Math.abs(fb.x - 0.5) < 1e-9 && Math.abs(fb.y - 0.5) < 1e-9, JSON.stringify(fb));

// Stabilizer params: smoother setting → lower cutoff than snappy setting.
var snappy = LumiGaze._stabilizerParams({ smoothingFactor: 0.05 });
var smooth = LumiGaze._stabilizerParams({ smoothingFactor: 0.45 });
ok('smoothing setting lowers cutoff', smooth.minCutoff < snappy.minCutoff, JSON.stringify([snappy.minCutoff, smooth.minCutoff]));

print('\n=== confidence scoring (real engine method) ===');
// [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]
var cGood   = LumiGaze._computeConfidence([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.25, 50, 60]);
var cClosed = LumiGaze._computeConfidence([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0.05, 50, 60]);
var cTurned = LumiGaze._computeConfidence([0.5, 0.5, 0.5, 0.5, 30, 25, 0, 0.25, 50, 60]);
ok('clean frame scores 1.0', Math.abs(cGood - 1.0) < 1e-9, 'score=' + cGood);
ok('blink / closed eye is penalised', cClosed < cGood, 'score=' + cClosed);
ok('turned head is penalised', cTurned < cGood, 'score=' + cTurned);

print(fail === 0 ? '\nSMOKE OK\n' : '\nSMOKE FAILED\n');
if (fail) throw new Error('smoke failed');
