# Changelog

Changes to LumiIQ, the browser app at the root of this folder. The IDs (C1, H4, …) refer to the
findings in [AUDIT.md](AUDIT.md). The original app is preserved as git tag **`LumiIQ_V1`**.

## Unreleased — fixes from the Phase 0 audit (branch `fix/phase0-findings`)

Every fix has a regression test, written first and seen to fail on the old code. `npm test` runs:
- 32 gaze unit tests;
- the smoke test;
- 84 Node tests (83 pass, 1 recorded as a known limitation);
- 24 server tests.

It needs nothing installed.

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

### Design decisions made in these fixes — please confirm or change

1. Urgent phrases sound the alarm (M9). Which phrases should?
2. The face-lost alarm fires after 10 s by default (H3).
3. Repeating a letter requires looking away and back (M3).
4. There is one eyes-closed alarm per closure, and no rest/sleep mode yet (M11). A sleeping
   patient still triggers one alarm per closure.
5. Gaze clicks stay off until a calibration is accepted (M5).
6. Body map: "Back" is now a separate button (H5). The left/right convention is **unchanged**:
   "Left Arm" is drawn on the viewer's left, like a mirror, so it is the patient's left only if
   they read the diagram as a mirror. Worth confirming with users.

### Not verified here

- There was no webcam: camera and MediaPipe code paths were tested with synthetic landmarks and
  fakes, and need a manual end-to-end check.
- The scripts in AUDIT.md's appendix reproduce **V1** behaviour; run them against tag `LumiIQ_V1`.
