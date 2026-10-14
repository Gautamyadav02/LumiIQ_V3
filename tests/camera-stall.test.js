'use strict';
// Found while testing the evaluation wizard in Chrome (Phase B): the camera
// video was `autoplay muted`, and Chrome pauses such a video whenever it is
// scrolled out of sight. Scrolling the caregiver dashboard therefore stopped
// camera frames, and with them gaze tracking AND every safety alarm, silently
// (the no-face alarm only runs when frames arrive).
//
// Fix: playback is started explicitly, and a watchdog notices when camera
// frames stop for any reason, tries to resume, and alarms if they stay away.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/browser-env');
const { setupEngine, feedFrames, EYES_OPEN } = require('./helpers/engine');

/** An engine that is tracking, with a stand-in video element and notices captured. */
function tracking(settings) {
  const ctx = setupEngine({ settings });
  const video = Object.assign(ctx.env.element({ tag: 'video' }), {
    paused: false, plays: 0,
    play() { this.plays += 1; this.paused = false; return Promise.resolve(); },
  });
  ctx.gaze.videoElement = video;
  ctx.gaze.isTracking = true;
  ctx.notices = [];
  ctx.gaze.onNotice = (message, level) => ctx.notices.push({ message, level });
  ctx.gaze._startWatchdog();
  ctx.stalls = () => ctx.alerts.filter((a) => a.type === 'CAMERA_STALLED');
  ctx.video = video;
  return ctx;
}

test('index.html: the camera video does not rely on autoplay', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tag = html.match(/<video[^>]*id="caregiverVideo"[^>]*>/)[0];
  assert.doesNotMatch(tag, /\bautoplay\b/, 'Chrome pauses an autoplay-muted video when it is scrolled out of view');
  assert.match(tag, /\bmuted\b/);
  assert.match(tag, /\bplaysinline\b/);
});

test('starting the camera starts playback explicitly, and the watchdog with it', async () => {
  const ctx = setupEngine();
  const gaze = ctx.gaze;
  gaze.isInitialized = true;
  const track = Object.assign(new EventTarget(), { getCapabilities: () => ({}), stop() {} });
  ctx.env.window.navigator.mediaDevices.getUserMedia = async () => ({ getVideoTracks: () => [track], getTracks: () => [track] });
  const video = Object.assign(ctx.env.element({ tag: 'video' }), { plays: 0, play() { this.plays += 1; return Promise.resolve(); } });
  gaze.videoElement = video;
  const started = gaze.startCamera();
  await new Promise((r) => setImmediate(r));
  video.dispatchEvent(new Event('loadeddata'));
  assert.equal(await started, true);
  assert.equal(video.plays, 1);
  assert.notEqual(gaze._watchdog, null);
  gaze.stopCamera();
  assert.equal(gaze._watchdog, null, 'and it stops with the camera');
});

test('while frames keep arriving, nothing happens', () => {
  const ctx = tracking();
  feedFrames(ctx, 20000, EYES_OPEN);
  assert.equal(ctx.video.plays, 0);
  assert.deepEqual(ctx.notices, []);
  assert.deepEqual(ctx.stalls(), []);
});

test('if camera frames stop, the engine resumes the video and tells the caregiver', () => {
  const ctx = tracking();
  feedFrames(ctx, 1000, EYES_OPEN);
  ctx.video.paused = true;                       // the browser paused the video
  ctx.env.clock.advance(3000);                   // no frames for 3 s
  assert.ok(ctx.video.plays >= 1, 'play() was called to resume');
  assert.match(ctx.notices.at(-1).message, /camera frames/i);
  assert.equal(ctx.notices.at(-1).level, 'error');
  assert.deepEqual(ctx.stalls(), [], 'too early for the alarm');
});

test('if frames stay away for the face-lost time, one alarm says monitoring has stopped', () => {
  const ctx = tracking({ faceLostAlarmSec: 10 });
  feedFrames(ctx, 1000, EYES_OPEN);
  ctx.video.play = function () { this.plays += 1; return Promise.reject(new Error('refused')); };   // cannot be resumed
  ctx.env.clock.advance(9000);
  assert.deepEqual(ctx.stalls(), []);
  ctx.env.clock.advance(2500);
  assert.equal(ctx.stalls().length, 1);
  assert.match(ctx.stalls()[0].details, /monitoring has stopped/i);
  ctx.env.clock.advance(60000);
  assert.equal(ctx.stalls().length, 1, 'one alarm per stall');
});

test('when frames return the notice clears, and a later stall is reported again', () => {
  const ctx = tracking({ faceLostAlarmSec: 5 });
  feedFrames(ctx, 500, EYES_OPEN);
  ctx.env.clock.advance(7000);
  assert.equal(ctx.stalls().length, 1);
  feedFrames(ctx, 2000, EYES_OPEN);
  assert.equal(ctx.notices.at(-1).message, null, 'the notice is cleared');
  ctx.env.clock.advance(7000);
  assert.equal(ctx.stalls().length, 2);
});

test('no stall is reported while the page is hidden, or after the camera is stopped', () => {
  const hidden = tracking({ faceLostAlarmSec: 5 });
  feedFrames(hidden, 500, EYES_OPEN);
  hidden.env.document.hidden = true;             // hidden pages pause frames: logged separately (H3)
  hidden.env.document.dispatchEvent(new Event('visibilitychange'));
  hidden.env.clock.advance(60000);
  assert.deepEqual(hidden.stalls(), []);
  hidden.env.document.hidden = false;
  hidden.env.document.dispatchEvent(new Event('visibilitychange'));
  hidden.env.clock.advance(3000);
  assert.deepEqual(hidden.stalls(), [], 'the time spent hidden does not count');

  const stopped = tracking({ faceLostAlarmSec: 5 });
  feedFrames(stopped, 500, EYES_OPEN);
  stopped.gaze.stopCamera();
  stopped.env.clock.advance(60000);
  assert.deepEqual(stopped.stalls(), []);
});

test('the pause while a calibration is being computed is not mistaken for a stalled camera', () => {
  const ctx = tracking();
  const gaze = ctx.gaze;
  gaze.startCalibration(5);
  for (let point = 0; point < 5; point++) {
    feedFrames(ctx, 700, EYES_OPEN);
    if (point === 4) {
      // Training blocks the page: no camera frame can be handled while it runs.
      const run = gaze._calibRun, train = run.train.bind(run);
      run.train = (screen) => { ctx.env.clock.now += 3000; return train(screen); };
    }
    gaze.captureCalibrationPoint();
  }
  ctx.env.clock.advance(1500);                   // the watchdog's next check, before the next frame
  assert.deepEqual(ctx.notices.filter((n) => n.message && /camera frames/i.test(n.message)), []);
  assert.equal(ctx.video.plays, 0);
});
