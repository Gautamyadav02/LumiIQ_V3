# Changelog

Changes to LumiIQ, the browser app at the root of this folder. The IDs (C1, H4, …) refer to the
findings in [AUDIT.md](AUDIT.md). The original app is preserved as git tag **`LumiIQ_V1`**.

## Unreleased — Phase C: seven accuracy changes, each switchable (branch `phase-c-gaze`)

Aimed at the poor gaze accuracy seen in real use. **None of them has been measured on a person
yet:** no session has been recorded, so `eval/IMPROVEMENTS.md` is an empty template. Every number
produced so far is synthetic. Design decisions, the held-out split and the success criteria, fixed
before any recording: [ADR 0003](docs/adr/0003-phase-c-ablation.md).

All seven are **on by default on this branch**. `LumiGaze.setImprovements('none' | 'all' | ['C1', …])`
switches them (not saved; a reload restores the defaults). With all off, the app behaves exactly
as at the end of Phase B; the tests check this.

### Changed (each one a switch)

- **C1 Head-pose compensation** (`gaze/gaze-features.js`).
  - **What:** with the head matrix and landmark depth, the iris position is measured in the
    head's own frame. It is measured along the eye-corner line, and below it in eye widths.
    The head turn and nod are then added back as 0.4 × sin(angle).
  - **Why:** gaze direction is head angle plus eye angle. The separate angle features had
    almost no spread in a head-still calibration, so any later head movement was blown up.
  - **Kept as before:** the "iris at the corner" confidence check, the raw ratio on the
    Diagnostics inset and the uncalibrated cursor still use the iris-in-eye ratio.
  - **Fallback:** without a matrix or depth, the Phase B features are used.
  - **Calibrations:** they are now version 4 (feature set "head").
- **C2 Eye-opening floor** (0.16).
  - **What:** an eye is used for gaze only above max(EAR threshold, 0.16). Confidence now
    rises gradually above the floor, instead of halving below 0.12.
  - **Unchanged:** blinks and the eyes-closed alarm use the caregiver's threshold.
  - **New reason:** "eyes_narrow" (open, but too narrow), shown on the status pill and in
    Diagnostics.
- **C3 Stricter outlier filter:** a calibration sample is kept only if fewer than a quarter
  of its features are outliers (before: up to 3 of 10).
- **C4 Settle guard:** calibration samples from the first 300 ms after a target appears are
  ignored. The app already waits 500 ms, so this is a second guard.
- **C5 Degree 1 or 2:** the calibration fits both and keeps the one with the lower
  leave-one-target-out error. Degree 1 gets its own lambda grid.
- **C6 Confidence-weighted smoothing:** the smoother's cutoff is scaled by the frame's
  confidence (never below 0.3×), so less trusted frames are smoothed more.
- **C7 Directional drift detector.**
  - **What:** recalibration is suggested after 6 selections in a row on the same side of the
    target's centre, or a median offset over 0.35 of the target size. A new calibration starts
    the detector afresh.
  - **Before:** the old average-distance rule almost never fired (audit M10).

### Added

- **`npm run eval:ablation`** → `eval/IMPROVEMENTS.md`. It replays every session with:
  - the baseline;
  - each change alone;
  - all seven together.

  Held-out sessions (the last recording day) are the result; development sessions are listed
  apart. `--synthetic` writes a gitignored pipeline check.
- **Replay** (`eval/replay.js`):
  - **"As recorded"** now means the switches each session was recorded with.
  - **`--improvements`** picks a variant.
  - **Rebuilt features:** the features are recomputed from the landmarks, with the recorded
    camera aspect ratio, when C1 or C2 differ.
  - **Timing:** calibrations are re-fitted at the recorded times.
  - **Also replayed:** the dwell half of the selection test and the drift detector.
- **Sessions** record the switches in force, the camera picture's size, and when each
  calibration point was committed. The last two are also on `phase-b-eval`, so that baseline
  sessions have them.
- **`eval:report`** lists the improvements each session was recorded with. It warns that
  sessions recorded with them on are not the Phase B baseline.
- **Server:** accepts a version-4 calibration, and checks that its version and feature set
  agree.

### Fixed

- **A saved calibration is restored only if it fits.** It must have been made from the features
  in use; otherwise the caregiver is asked to recalibrate, and nothing crashes.
- **Settle-guard frames:** a frame the C4 guard drops is no longer marked as a calibration
  sample in the session record.

## Unreleased — Phase B: the evaluation tool (branch `phase-b-eval`)

The tool the dissertation's Section 3.6 describes. How to record: [docs/RECORDING.md](docs/RECORDING.md).
Design decisions: [ADR 0002](docs/adr/0002-evaluation-tool.md). **No real session has been recorded
yet, so `eval/BASELINE.md` is still empty.** Every number produced so far is synthetic.

The branch started from commit `93404f3`, a first attempt at this phase made in another session.
That attempt was replaced, because it could not run and would have misled:
- the wizard could not start a session in a browser, and the consent box was pre-ticked;
- 7 of the 10 stages existed, and false activations were counted on a blank screen;
- a replay could not rebuild the calibration and silently predicted the screen centre;
- an empty measurement was reported as 0 px.

### Added

- **Evaluation wizard** (Caregiver → Diagnostics → *Start an evaluation session*, about 10 minutes).
  - **Ten stages:**
    1. consent;
    2. viewing distance and screen width;
    3. settings reset;
    4. 9-point calibration;
    5. 12 held-out targets;
    6. six head movements;
    7. selection test by dwell and by blink;
    8. a 2-minute rest;
    9. lag and jitter at two smoothing levels;
    10. 16-point calibration and the 12 targets again.
  - **Consent:** never pre-ticked. Nothing is recorded before it is given, and stopping saves nothing.
  - **Selection test and rest:** they use the real keyboard, with selections intercepted. Nothing
    is typed or spoken, and Nurse Call cannot fire.
  - **Operator only:** no control is a gaze target. Safety alarms stay on.
- **Session recording** (`eval/session-recorder.js`).
  - **Numbers only:** per frame, 16 landmarks, the head matrix, features, predictions and
    timestamps. Never video or images.
  - **Also per session:** the camera picture's size in pixels (its aspect ratio is needed to
    turn normalised landmarks back into true proportions), and the time each calibration point
    was committed.
  - **Checked twice:** the recorder and the server both reject long or image-like text.
  - **Storage:** one JSON file per session in the gitignored `eval/sessions/`.
- **`POST /api/eval/session`**: saves a session through the local server.
  - It has its own size limit, validates the session, and never overwrites.
  - Sessions are never served back.
- **Metrics** (`eval/metrics.js`).
  - **Gaze:** accuracy, precision and 95th-percentile error, for x and y, in pixels and degrees.
  - **Selection:** wrong and missed selections, time per correct selection, false activations
    per minute.
  - **Lag:** settling time and fixation jitter.
  - No data gives "no number", never zero.
- **Replay** (`eval/replay.js`, `node eval/replay.js`): runs a recorded session through the real
  gaze code and reports how closely it reproduces the live gaze. Options change the model degree,
  the cross-validation method and the smoothing.
- **Report** (`npm run eval:report` → `eval/BASELINE.md`).
  - The dissertation's Tables 4.6 and 4.7 as mean ± SD with n.
  - The 95th-percentile error and the smallest target it allows.
  - The in-app estimate beside the measured error.
  - The session ids behind every row.
  - `-- --synthetic` writes a separate, clearly marked pipeline check.
- **`gaze/gaze-features.js`**: feature extraction as a shared module, so the app and the replay
  run the same code. Behaviour unchanged.

### Fixed

- **The camera stopped when its picture was scrolled out of view.**
  - **Cause:** the video was `autoplay muted`, and Chrome pauses such a video when it is not
    visible. Scrolling the dashboard's left column hid it.
  - **Effect:** camera frames stopped, and with them gaze tracking and every safety alarm,
    silently.
  - **Found by:** running the wizard in real Chrome.
  - **Fix:** playback is now started explicitly. A **watchdog** notices when camera frames stop
    for any reason, tries to resume, shows a notice, and raises a `CAMERA_STALLED` alarm if they
    stay away for the face-lost time.
- **M1: the calibration quality report used optimistic cross-validation.** It now leaves one
  whole target out at a time, and says which method it used.
  - **Honest scope:** this estimate errs on the safe side; it is not a measurement of accuracy.
    The held-out targets are.
  - **Lambda is chosen the same way,** so the trained model can differ from before.
  - **Cost: calibration takes longer to compute** (Node, development Mac, synthetic samples):

    | Points | Before | After |
    |---|---|---|
    | 9 | 83 ms | 189 ms |
    | 16 | 144 ms | 612 ms |
    | 25 | 227 ms | 1,572 ms |

### Verified

- `npm test`: every new behaviour has a test that failed first.
- The wizard was run end to end in headless Chrome with a simulated face: all ten stages, saved as
  one session, no console errors.
- On simulated sessions the replay reproduces the model's output to within 0.01 px.

### Not verified

- **No real person has been recorded.** The tool has only been driven by simulated faces.
- **The head-movement guidance** depends on the sign and scale of MediaPipe's head angles on a
  real camera, which is still unconfirmed (Phase A check D5).

## Unreleased — Phase A: diagnosis tools (branch `phase-a-diagnosis`)

These are diagnostic tools only: gaze, dwell, blink and alarm behaviour are unchanged, and all
existing tests pass unchanged. The written diagnosis is in
[docs/diagnosis/phase-a.md](docs/diagnosis/phase-a.md); the design decisions are in
[ADR 0001](docs/adr/0001-caregiver-diagnostics.md).

### Added

- **Detection overlay on the live feed** (Caregiver tab, "Show detection overlay", off by
  default).
  - **On the video:** iris centres, the eyelid and corner points used for EAR, and EAR per eye.
  - **In a box under the video:** confidence, head pose, and whether the frame produced a gaze
    point, and why not.
  - **Alignment:** checked in Chrome with a fake camera; markers land within about 1 px of the
    video content they describe (synthetic video).
- **Diagnostics card:**
  - **Frame statistics:** % frames with a face and with a gaze point, the reasons for missing
    ones, confidence and EAR distributions, and how many "open" samples the default EAR
    threshold would call closed.
  - **Eyes open / closed check** (8 s, guided by a dot and chimes): says how the current EAR
    threshold classifies this person's open eyes, looking up and down, and closed eyes.
  - Figures stay on this screen and are never saved or sent.
- **Reset settings to defaults** (Platform Settings), with a confirmation. The calibration, the
  logs and sleep mode are kept.
- **Engine: a passive per-frame record** (`LumiGaze.onFrameInfo` / `lastFrameInfo`) of what
  was detected. Nothing in the pipeline reads it.
- **`eval/synthetic/ear-threshold.js`:** a synthetic analysis of what the EAR threshold
  changes, run on the real modules.

### Fixed

- **The amber crosshair on the live feed.**
  - **The problems:** it plotted the iris-in-eye ratio across the whole video, so it never sat
    on an eye; it moved the opposite way to the eyes, because the canvas was CSS-mirrored and
    the code flipped it again; and its text was drawn backwards.
  - **Now:** a small "eye direction" inset that moves with the eyes. The canvas is no longer
    mirrored; camera coordinates are mapped onto the mirrored, cropped video in one place.
- **Defaults could be overwritten.** Changing a setting before the store had loaded could
  alter the built-in defaults.

### Found, not changed yet (need the Phase B baseline or a decision)

- **EAR threshold 0.11** (the saved value on the development machine) counts eyes at EAR
  0.12–0.16 as open. Such frames give gaze points and calibration samples, and they never
  raise the eyes-closed alarm (synthetic). The right value is this person's; the eyes
  open/closed check measures it.
- **Calibration's outlier filter** keeps a frame that is off in exactly 3 of the 10 features,
  which is what an eyelid-disturbed frame looks like (synthetic: 6/6 kept).
- **"Left Eye Only" appears to track the patient's right eye**, following MediaPipe's
  landmark naming, unless "Swap" is on. Confirm with the wink check (D3) before changing it.

Tests:
- `tests/diagnostics.test.js` (10)
- `tests/diagnostics-module.test.js` (11)
- `tests/diagnostics-app.test.js` (8)
- additions to `store.test.js`, `app.test.js`, `gaze-targets.test.js` and
  `scripts-load.test.js`

## Unreleased — fixes from the Phase 0 audit (branch `fix/phase0-findings`)

Every fix has a regression test, written first and seen to fail on the old code. `npm test` runs:
- 32 gaze unit tests;
- the smoke test;
- 112 Node tests (111 pass, 1 recorded as a known limitation);
- 26 server tests.

It needs nothing installed.

### Added — sleep mode (caregiver button), at the user's request

- **What it does.** The caregiver turns on **Sleep Mode** (dashboard) when the patient goes to
  sleep. Only the eyes-closed alarm is paused, because closed eyes are normal in sleep. The no-face,
  camera-lost and rapid-blinking alarms, Nurse Call and urgent phrases all stay on, so monitoring
  continues.
- **Activity reports.** Once the patient has fallen asleep (eyes closed for 30 s), waking up (eyes
  open for 5 s, adjustable 2–60 s) or any selection is reported to the caregiver once per waking.
  The report is a chime, a banner and a `SLEEP_ACTIVITY` entry in Safety Alerts. It re-arms when
  the patient falls asleep again. Turning sleep mode on while the patient is still awake does not
  trigger a report.
- **Staying visible.** A 🌙 badge shows in the header while it is on. Switching it on or off is
  logged (`SLEEP_MODE_ON` / `SLEEP_MODE_OFF`), and it survives a page reload.
- **Safety net.** It switches itself off after 12 hours, in case it is forgotten, and says so. A
  stored end time more than 12 hours ahead is ignored.
- **Limits:**
  - Reports stay **on this device**; nothing is sent to a phone.
  - The camera needs some light at night. In the dark it cannot see the face, and the no-face
    alarm will sound.
- Tests: `tests/sleep-mode.test.js` (12), an app test, a server test, and the button is on the
  "not a gaze target" list.

### Added — blink to select ("blink to write"), at the user's request

- **How it works.** Look at a key (or any gaze target), then close your eyes deliberately for at
  least 0.5 s, and less than 1.5 s. The target the gaze had rested on is selected. Blinking again
  selects it again, which is the easy way to type a double letter.
- **What doesn't select.** Normal blinks (~0.1–0.4 s) don't select. Closures of 3 s or more still
  raise the eyes-closed alarm.
- **Guards:**
  - the gaze must have rested on the target for 300 ms first, so a key the gaze merely passes is
    never selected;
  - the target from just before the eyelids closed is used, because the closing lid drags the
    estimate;
  - no blink selection happens before a calibration is accepted or during calibration;
  - deliberate blinks don't count towards the rapid-blinking alarm.
- **Caregiver settings:**
  - "Select with": Dwell or blink (default), Dwell only, or Blink only. In Blink only mode the ring
    fills to show the target is armed.
  - "Blink-select: eyes closed for (ms)": 300–1200, default 500.
  - "Keep looking to repeat a key": off by default, so to repeat you look away and back, or blink.
- **Risk to measure in Phase 1:** a slow involuntary blink while resting the eyes on a key can now
  select it. Phase 1 should count false selections with blink-select on and off.
- Tests: `tests/blink-select.test.js` (12), plus dwell-controller tests for the new options and a
  server test for the new settings.

### Critical

- **C1 — The server no longer exposes patient data to the network** (`server.py`).
  - **Before:** it listened on every network interface with no login, served the whole folder
    (databases, dotfiles, folder listings), sent `Access-Control-Allow-Origin: *`, and let anyone
    change safety settings (e.g. alarm volume 0).
  - **Now:** it listens on 127.0.0.1 only and checks the `Host` header. It sends no CORS headers,
    requires JSON for writes, serves only the app's files, and validates every stored value.
  - Tests: `tests/test_server.py`.
- **C2 — Gaze can activate only `.gazeable` elements.**
  - **Before:** any button counted, including the alarm's "CAREGIVER CONFIRMED" and
    "Stop Gaze Camera".
  - The Caregiver tab is no longer a gaze target either.
  - Tests: `tests/gaze-targets.test.js`.

### High

- **H1 — No click after closing the eyes or losing the face.**
  - A gap in gaze samples longer than 300 ms (a normal blink is shorter) now cancels the dwell.
    Before, the dwell completed on the first frame back.
  - Tests: `tests/dwell.test.js`.
- **H2 — The alarm text is honest.** It said "API webhook sent", but nothing is ever sent. It now
  says the alarm sounds on this device only. Tests: `tests/alerts.test.js`.
- **H3 — Monitoring no longer stops silently.** New alarms: no face for a set time
  (`FACE_NOT_DETECTED`, default 10 s, adjustable 5–60 s) and camera disconnected (`CAMERA_LOST`).
  - Hiding the app pauses camera frames in all browsers. That pause is now logged and reported on
    return.
  - Stopping the camera shows a persistent "monitoring is OFF" notice.
  - Tests: `tests/alerts.test.js`.
- **H4 — The body map works by gaze.** SVG zones have no `click()`, so gaze could never select a
  body part (mouse clicks worked). They now receive a dispatched click event.
  Tests: `tests/app.test.js`.
- **H5 — Body-map zones no longer overlap.**
  - **Before:** the centres of Chest and Stomach selected "Back", and Head selected "Eyes".
  - "Back", which cannot be drawn on a front view, is now a separate button, and the diagram column
    is wider.
  - Tests: `tests/body-map.test.js`.
- **H6 — Autocorrect never rewrites words.**
  - **Before:** SPACE turned "CANT" into "Want", "DONT" into "Door" and "OK" into "Or".
  - **Now:** a likely correction is only offered in the suggestion bar. Common contractions
    without an apostrophe (cant, dont, im, ok…) are now vocabulary words.
  - Tests: `tests/keyboard.test.js`.
- **H7 — Log text is never interpreted as HTML** in the caregiver dashboard, which prevents stored
  script injection. Tests: `tests/app.test.js`.
- **H8 — Speech prefers on-device voices.** Online voices ("Google…", "…Natural") fail without
  internet and send the patient's words to a cloud service. Speech failures now show a visible
  warning. Tests: `tests/voice.test.js`.
  - **Not verified:** which voices are local depends on your browser and OS; check this on the
    target machine.

### Medium

- **M3 — One activation per look.** The same target, or the same screen area if the UI redraws it,
  cannot fire again until the gaze leaves it. Before, a steady look fired a key every ~1.85 s.
  Tests: `tests/dwell.test.js`.
- **M5 — No gaze clicks before calibration.** The rough uncalibrated mapping could press random
  buttons. The cursor still shows, and the status pill explains why clicks are off.
  Tests: `tests/calibration-flow.test.js`.
- **M6 — A new calibration is used and saved only after Accept.**
  - **Before:** cancelling or failing a recalibration discarded the working model, and every result,
    even "Poor", was saved immediately.
  - Tests: `tests/calibration-flow.test.js`.
- **M7 — Each alarm is logged once.** Before, it was logged twice (three times for Nurse Call); your
  `eyecare.db` holds 38 rows for 16 events. Tests: `tests/alerts.test.js`.
- **M8 — Writes survive a server outage.** Messages, symptoms and alerts wait in a `localStorage`
  queue until the server confirms them. They keep their original time and are shown in the
  timeline meanwhile. Tests: `tests/store.test.js`.
- **M9 — Urgent phrases alert the caregiver.** "Call nurse", "I can't breathe", "I need help" and
  "I'm in pain" now raise the alarm like Nurse Call, and every phrase is logged.
  Tests: `tests/phrases.test.js`.
- **M11 — One eyes-closed alarm per closure.** Before, it repeated every 15 s while the eyes stayed
  closed. The siren still sounds until dismissed. Tests: `tests/alerts.test.js`.
- **M12 — The service worker no longer serves stale code.** It is network-first with a cache
  fallback, and it precaches MediaPipe's WebAssembly. Before, it was cache-first and never updated,
  so edits did not reach browsers. Tests: `tests/service-worker.test.js`.
- **M13 — CI tests the right codebase.** `validate.py` checks the out-of-scope v3 backend and
  writes to the v1 database. CI now runs `npm test` on Node 22 instead.

### Low

- **L1** Dwell progress never jumps backwards when the dwell time changes mid-dwell.
- **L2** The server validates settings, and ignores unknown keys.
- **L3** The dead "Sensitivity X/Y" sliders are removed.
- **L4** The status pill names the real reason for no gaze, and alarm messages are no longer
  overwritten by the next frame.
- **L5** Camera errors are named (no camera / camera in use / permission denied), and face
  tracking falls back from GPU to CPU.
- **L6** Calibration time hints are correct; unmeasured "high accuracy" labels are removed.
- **L7** Eyes-closed detection also runs during calibration.
- **L8** "Computing calibration…" is shown before training.
- **L9** Fonts are no longer fetched from Google.
- **L10** `dlib_tracker.py` keeps TLS verification on.
- **L11** Double clicks no longer load the engine twice or start two camera loops.
- **L12** Inaccurate comments and README statements are corrected, and old documents carry an
  "out of date" banner.

Tests: `tests/engine-lifecycle.test.js`, `tests/no-external-requests.test.js`, and others above.

### Tests themselves

- **T1, T2** `gaze/test_confidence.js` and `gaze/test_drift.js` now assert things. Before, they
  printed "PASS" whatever happened.
- **T3** `gaze/_smoke.js` runs under Node, and so in CI.
- **T4** The synthetic calibration test uses the real 10-feature vector.
- New: `tests/helpers/browser-env.js`, a small fake browser that loads the real script files into
  Node, and `tests/helpers/engine.js`, which drives the real engine with synthetic face landmarks.

### Not changed yet: these need Phase 1 measurements first (rule 1)

- **M1** The calibration quality report and the method for choosing λ.
- **M2** Head-movement handling.
- **M4** Hysteresis or a grace period at target edges.
- **M10** A drift detector that works. It is kept as a `todo` test.
- **L6 (timing)** The capture window starts as the dot animation ends.

These change gaze accuracy or dwell behaviour, so each needs a before/after number from the
evaluation harness. Because V1 is tagged, the Phase 1 baseline can still be recorded on the
original code.

### Design decisions (user's answers, 2026-09-23)

1. Urgent phrases sound the alarm (M9): **confirmed**.
2. The face-lost alarm fires after 10 s, adjustable 5–60 s (H3): **confirmed**.
3. Repeating a letter (M3): look away and back is **optional**. Blink to select was added (above),
   and "keep looking to repeat" is a setting.
4. Eyes-closed alarm while the patient sleeps (M11): **resolved** with the caregiver's Sleep Mode
   button (above).
5. Gaze clicks stay off until a calibration is accepted (M5): **confirmed**.
6. Body map: "Back" is a separate button, and the mirror left/right convention is unchanged (H5):
   **confirmed**.

### Not verified here

- There was no webcam: camera and MediaPipe code paths were tested with synthetic landmarks and
  fakes, and need a manual end-to-end check.
- The scripts in AUDIT.md's appendix reproduce **V1** behaviour; run them against tag `LumiIQ_V1`.
