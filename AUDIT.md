# AUDIT — Phase 0 (read-only)

**Project:** LumiIQ (the same code is also branded "EyeCare"; see §8) · **Folder:** `/Users/axel/EyeCare` · **Date:** 2026-09-23
**Mode:** read-only. Apart from this file, nothing in the project folder was created or changed. Every experiment ran on copies in a scratch directory (Appendix B).

> **How to read this.** §0 is a one-page summary. §4 lists the bugs, ranked by severity, with file:line links and repro steps. §5 analyses the gaze pipeline, the part you will have to defend in the viva.
> Evidence labels:
> - **Reproduced**: I ran it against the unmodified code (script in Appendix A).
> - **Measured**: a number from a test run or from your databases.
> - **Code**: established by reading the code; not yet exercised with a live webcam.
> - **Suspected**: plausible, but still needs checking.
>
> **No number in this document measures the app's gaze accuracy on a real person.** That is Phase 1's job.

---

## 0. Summary

**What the target codebase actually is.** The pipeline in your brief (MediaPipe landmarks → ridge-regression calibration → adaptive dwell FSM → selection → TTS) exists, and works end to end, only in the **browser app at the folder root**. That app is `index.html`, `app.js`, `gaze-engine.js` and `gaze/*.js`, plus a Python server (`server.py`, standard library only) backed by SQLite.
- The gaze pipeline is **JavaScript running in the browser**, using MediaPipe Tasks for Web.
- It has **no PyQt6, no Claude API client and no Twilio integration**.
- PyQt6 is not installed on this machine. Twilio code exists only in `archive/platform/`, which is out of scope.

I audited the root app as the target; please confirm that choice (§9, Q1).

**Tests.** The gaze unit tests pass: 32/32 under Node (the CI command) and 32/32 under `jsc`. The smoke test passes 10/10 under `jsc`. Several things undercut that result:
- Two of the four JS test files contain no assertions and always print PASS. One of them currently prints a wrong result.
- The smoke test crashes under Node.
- The second CI step, `validate.py`, fails because it checks the out-of-scope v3 backend.
- The folder is not a git repository, so CI has never run.

**Most important findings** (34 in total, §4):

| ID | Finding |
|---|---|
| **C1 Critical** | `server.py` serves the whole project folder on every network interface, with no authentication. Anyone on the same network can download the databases, read or delete the patient's logs, and set the alarm volume to 0. |
| **C2 Critical** | Gaze can activate *any* `<button>`. That includes "CAREGIVER CONFIRMED — Dismiss" on the alarm and "Stop Gaze Camera", so the patient's gaze can silence an alarm or switch off all monitoring. |
| **H1** | A dwell completes instantly on the first frame after the eyes reopen or the face returns (Midas touch). |
| **H2** | The alarm screen says "API webhook sent", but nothing is sent anywhere. |
| **H3** | Safety monitoring stops silently when the browser tab is hidden, the camera is unplugged, or the face leaves the frame. |
| **H4, H5** | The body map cannot be operated by gaze, because SVG zones have no `click()`. Where zones overlap, looking at the chest or stomach centre selects "Back". |
| **H6** | Autocorrect silently changes meaning: "CANT"→"Want", "DONT"→"Door", "OK"→"Or". |
| **H7, H8** | Stored XSS in the caregiver dashboard. Speech output prefers online voices (suspected silent failure when offline). |

**The gaze pipeline in one paragraph.** 10 hand-built features (iris-in-eye ratios, head Euler angles, eye aspect ratio, two face-scale measures) → degree-2 polynomial expansion (65 terms) → z-score → two ridge regressions (66 weights each), with λ picked from a 6-value grid by 5-fold cross-validation → One-Euro filter plus a 2.5 px deadband → a 3-state dwell FSM with a 600 ms cooldown. Its main weaknesses:
- **The calibration "quality" shown to the user is not a reliable accuracy estimate.** It rated all 8 synthetic test scenarios "Excellent", including one where the error at new screen positions was 5× the reported figure.
- **Head movement after calibration is extrapolated badly.**
- **The dwell FSM has three gaps:** no handling of tracking gaps, no hysteresis at target edges, and no "look away before it can fire again" rule.
- **Your own stored calibration reports roughly 180 px of error**, more than half a letter key's width (66 px at 1440×900).

**Security and privacy.** I found no real API keys, tokens or private keys, either in the working tree or in staged git blobs. The two SQLite databases hold real usage data: typed messages, symptom reports, alerts, and a calibration derived from a face. They must never be committed. The only git repository is the archived platform's, which has 0 commits and no remote.

**Not measured here:** real accuracy, precision, dwell error rates and lag. Those need your webcam (Phase 1).

---

## 1. Scope: your brief vs. what exists

| Your brief says | Found in the target | Where |
|---|---|---|
| Python | Only the local server (`server.py`, standard library only) and two standalone scripts: `validate.py` (it checks the v3 backend) and `dlib_tracker.py` (an unused OpenCV/dlib prototype) | [server.py](server.py) |
| OpenCV | Not used by the app. Appears only in `dlib_tracker.py` and the out-of-scope `backend/` | — |
| MediaPipe | MediaPipe Tasks Vision **for the web**, v0.10.14, vendored in `lib/mediapipe/`, with the model `models/face_landmarker.task` | [gaze-engine.js:72-87](gaze-engine.js#L72-L87) |
| PyQt6 | Absent. Not installed for Python 3.14 or 3.11, and not found in the sibling projects I checked (`Oculink/`, `EGT/`, `DeepGaze-Experiment/`) | — |
| SQLite | Yes: `lumiiq.db`, via `server.py` | [server.py:68-232](server.py#L68-L232) |
| TTS | The browser's Web Speech API | [voice.js](voice.js) |
| Claude API | Absent. `.claude/` only holds Claude Code tooling settings | — |
| Twilio | Absent from the target. Only in `archive/platform/backend/app/services/notifications.py` | — |
| Ridge-regression calibration | Present | [gaze/ridge-regression.js](gaze/ridge-regression.js), [gaze/gaze-calibration.js](gaze/gaze-calibration.js) |
| Adaptive dwell FSM | Present | [gaze/dwell-controller.js](gaze/dwell-controller.js), [gaze-engine.js:394-403](gaze-engine.js#L394-L403) |

| Path | What it is | How I treated it |
|---|---|---|
| Root: `index.html`, `*.js`, `gaze/`, `server.py`, `sw.js`, `manifest.json`, `styles.css`, `lib/`, `models/`, `icons/` | "v1", the only working implementation | **Target (audited)** |
| `backend/` | "v3" FastAPI backend. Its gaze pipeline is unreachable, and its `vision` package fails to import | Out of scope; read only where it touches the target (§2.5) |
| `archive/platform/` | The "platform" SaaS rewrite; a nested git repo with 0 commits | Out of scope; secret scan only |
| `archive/frontend/` | The v3 frontend | Out of scope |
| Root `*.md` files, `docs/` | Documentation, mostly about v3 | Checked for claims (§7) |
| `validate.py`, `dlib_tracker.py`, `start.sh`, `.github/`, `.claude/` | Tooling | Audited |

Your brief lists "browser version" as out of scope. But the root *is* the browser version, and it is where the pipeline you described lives. If you meant a different folder, tell me before Phase 1 (§9, Q1).

---

## 2. Architecture

### 2.1 Modules

All modules are plain scripts that share globals on `window`. There is no module system and no build step. Modules also talk through four `CustomEvent`s: `eye_emergency_alert`, `eye_text_spoken`, `eye_symptom_reported` and `lumiiq-settings-changed`.

| File | Lines | Global | Role |
|---|---|---|---|
| [index.html](index.html) | 283 | — | Page shell: 4 tabs (Keyboard, Phrases, Body Map, Caregiver), a calibration overlay and an emergency overlay. Loads the scripts in dependency order |
| [database.js](database.js) | 180 | `LumiStore` | REST client for `server.py`. Keeps an in-memory cache, and mirrors settings and calibration (but not logs) to `localStorage` |
| [dictionary.js](dictionary.js) | 177 | `LumiDictionary` | Word prediction (prefix matching and next-word pairs) and autocorrect (edit distance ≤ 2) |
| [voice.js](voice.js) | 76 | `LumiVoice` | Wrapper around the Web Speech API |
| [gaze/one-euro-filter.js](gaze/one-euro-filter.js) | 143 | `OneEuroFilter`, `OneEuroFilter2D` | Speed-adaptive low-pass filter |
| [gaze/ridge-regression.js](gaze/ridge-regression.js) | 354 | `RidgeRegressor`, `GazeRegressionMath` | Polynomial features, z-score scaling, ridge regression solved by QR, cross-validation, λ selection |
| [gaze/gaze-stabilizer.js](gaze/gaze-stabilizer.js) | 89 | `GazeStabilizer` | 2-D One-Euro filter plus deadband and clamping |
| [gaze/dwell-controller.js](gaze/dwell-controller.js) | 171 | `DwellController` | The dwell state machine |
| [gaze/gaze-calibration.js](gaze/gaze-calibration.js) | 272 | `GazeCalibration` | Target layout, sample collection, MAD-based outlier rejection, training, quality report, save/load |
| [gaze/drift-detector.js](gaze/drift-detector.js) | 24 | `DriftDetector` | A heuristic for suggesting recalibration |
| [gaze-engine.js](gaze-engine.js) | 529 | `LumiGaze` | Orchestrator: MediaPipe, feature extraction, confidence, blink and emergency detection, calibration flow, the per-frame loop |
| [keyboard.js](keyboard.js) | 164 | `LumiKeyboard` | QWERTY keyboard, suggestions, SPEAK and Nurse Call |
| [body-map.js](body-map.js) | 185 | `LumiBodyMap` | SVG body zones → symptom → log entry and speech |
| [phrases.js](phrases.js) | 33 | `LumiPhrases` | 16 fixed phrases, spoken on selection |
| [app.js](app.js) | 547 | `EyeApp` | Controller: tabs, callback wiring, gaze cursor, dwell ring, click dispatch, siren, calibration UI, settings, log dashboard |
| [sw.js](sw.js) | 52 | — | Service worker, cache-first |
| [server.py](server.py) | 382 | — | `ThreadingHTTPServer`: static files, a JSON API and SQLite |

### 2.2 Data flow: camera frame → spoken output

```
webcam ─getUserMedia (1280×720 @30 requested)─▶ <video>                          gaze-engine.js:153-189
  │ requestVideoFrameCallback: one callback per new camera frame (rAF fallback)   gaze-engine.js:205-244
  ▼
FaceLandmarker.detectForVideo  → 478 landmarks + 4×4 head transform (GPU delegate) gaze-engine.js:72-87
  ▼
_extractFeatures → [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd] + open/closed per eye   :294-343
_computeConfidence → 0..1 (EAR sanity, iris inside eye, head-pose extremes)                     :251-268
  ├─ calibrating? → GazeCalibration.addSample → (UI timer) commitPoint → train → save, then return  :360-368, 486-514
  ├─ _updateBlinkState → blink count / prolonged closure → _triggerEmergency                     :371, 434-470
  ├─ eyes closed, or confidence < 0.2 → return (no prediction, dwell FSM NOT updated)           :373-382
  ▼
calibrated ? GazeCalibration.predict (2 ridge models, clamped 0..1) : _fallbackMap (fixed gain)  :385-387
  ▼ × window.innerWidth / innerHeight
GazeStabilizer.process: One-Euro (x and y) + 2.5 px deadband + clamp          gaze/gaze-stabilizer.js:43-68
  ├─▶ onGazeUpdate → cursor, status pill, debug canvas                          app.js:111-142
  ▼
dwell time = setting × 1.3 (smoothed confidence < 0.7) or × 2.0 (< 0.4)        gaze-engine.js:394-402
DwellController.update(x, y, t), hitTest = elementFromPoint at 20 Hz → .gazeable | <button> | <a href>
  ├─▶ onProgress → conic "dwell ring"                                            app.js:144-158
  ▼ onActivate
EyeApp._onDwellClick → drift check → el.click()                                  app.js:160-181
  ▼ (ordinary DOM click handlers)
keyboard: letter → text buffer · SPACE → autocorrect · SPEAK → log + speak       keyboard.js:79-156
phrases: speak only                                                               phrases.js:26-30
body map: zone → symptom → log + speak   (gaze path broken, see H4)             body-map.js:125-161
Nurse Call → alert log + eye_emergency_alert → overlay + siren                    keyboard.js:158-163; app.js:59-61, 188-232
  ▼
LumiVoice.speak → speechSynthesis → audio                                         voice.js:50-75
LumiStore.add*Log → POST /api/logs/* → server.py → SQLite                         database.js:115-138; server.py:160-191
```

### 2.3 Threading model

- **Browser: one main thread does everything.** That covers MediaPipe inference (`detectForVideo` is a synchronous call, with the GPU work done through WebGL), feature extraction, regression, filtering, the FSM, DOM updates, speech calls, and calibration training at the end of a calibration run. There are no Web Workers.
- **Scheduling.**
  - `requestVideoFrameCallback` drives the frame loop, with `requestAnimationFrame` as a fallback.
  - `setInterval` drives the siren (every 500 ms).
  - `setTimeout` handles the 15 s emergency re-arm, the 250 ms settings debounce, and the 600 ms calibration retry.
  - `requestAnimationFrame` drives the calibration animation.
- **Hidden or minimised tab.** Video-frame and animation callbacks pause, so gaze processing *and* safety detection stop (H3).
- **Calibration training** runs synchronously. It took 74–259 ms in Node on this Mac for 5–25 points; it will be slower on a tablet (L8).
- **Server.** `ThreadingHTTPServer` handles each request on its own thread. One global lock serialises all SQLite access. Each call opens a new SQLite connection and never explicitly closes it, relying on garbage collection.
- **Service worker.** Runs on its own thread; answers requests from its cache first (M12).

### 2.4 Where state lives

| State | In memory | Persisted |
|---|---|---|
| Calibration model (weights, scaler, report) | `LumiGaze.calibration` | `localStorage["lumiiq_calibration"]` and the server's `kv('calibration')`. On startup the server copy wins |
| Settings | `LumiStore._cache.settings`. The engine holds the same object by reference | `localStorage["lumiiq_settings"]` and the server's `kv('settings')`. On startup the server copy wins |
| Filter state; dwell FSM | `GazeStabilizer`, `DwellController` | — |
| Blink history, eyes-closed timer, alarm flag | `LumiGaze` | — |
| Sentence being typed | `LumiKeyboard.currentText` | — (lost on reload) |
| Selected body part | `LumiBodyMap.selectedPart` | — |
| Logs (typed, symptom, alert) | `LumiStore._cache` | **Server SQLite only.** Not mirrored locally (M8) |
| Static files | — | Service-worker cache `lumiiq-v3`, never revalidated (M12) |

### 2.5 Where out-of-scope code touches the target

- [backend/app/database/database.py:12](backend/app/database/database.py#L12) points at **the same root `lumiiq.db`**. Running the v3 backend, or `validate.py` with its dependencies installed, adds v3 tables to the v1 database (M13).
- [start.sh:37](start.sh#L37) and [start.sh:59](start.sh#L59) launch `backend/server.py` (v3), not the v1 `server.py`. [README.md:44](README.md#L44) says they do "the same thing".
- CI runs `validate.py`, which only checks v3 (§3).

---

## 3. Test suite

### 3.1 Results (run 2026-09-23 on this Mac)

| Suite | Command | Result |
|---|---|---|
| Gaze unit tests (CI step 1) | `node gaze/test_gaze.js` (Node v24.18.0) | **32 passed, 0 failed**, exit 0 |
| Same file | `jsc gaze/test_gaze.js` | 32 passed, exit 0 |
| Smoke test (stubbed DOM) | `jsc gaze/_smoke.js` | 10 passed, exit 0 |
| Same file | `node gaze/_smoke.js` | **Crash:** `ReferenceError: load is not defined`, exit 1 |
| Drift "test" | `node gaze/test_drift.js` | Exit 0 and prints "PASS", but prints `Bad clicks trigger recalib? false` where its own comment expects `true`. It has no assertions |
| Confidence "test" | `node gaze/test_confidence.js` | Exit 0. No assertions, and it tests a *copy* of the function rather than the engine's |
| CI step 2 | `python validate.py` (Python 3.14, run on a copy) | **1/7 checks, exit 1** |
| Same | Python 3.11 (FastAPI and friends installed; run on a copy) | 4/7 checks, exit 1. It **created a `lumiiq.db`** next to the copy |
| npm | `npm test` | Exit 1: the placeholder "no test specified" script |
| `backend/tests/` | — | Empty directory |

**CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) would fail at "Python Validation": there is no `pip install` step, and `frontend/` has moved into `archive/`. It uses Node 18 and runs only `test_gaze.js`. Because the folder is not a git repository, the workflow has never run.

### 3.2 What the tests do and don't cover

- **T1.** [gaze/test_confidence.js](gaze/test_confidence.js) re-implements `_computeConfidence` locally and asserts nothing, so it can never fail.
- **T2.** [gaze/test_drift.js](gaze/test_drift.js) asserts nothing. Its output contradicts its own comment, which also demonstrates M10.
- **T3.** [gaze/_smoke.js](gaze/_smoke.js) only runs under `jsc`, and CI (Node) never runs it.
- **T4.** The end-to-end calibration test ([gaze/test_gaze.js:177-235](gaze/test_gaze.js#L177-L235)) is too easy to catch the problems in §5.5–5.6:
  - It builds an **8-feature** vector, while production uses 10.
  - It makes head pose *correlated with the target*, the opposite of the "keep your head still" instruction.
  - It models only per-frame noise, with no per-target fixation error.
  - It checks "fresh" targets generated by the same model.
- **T5.** There are no tests for `app.js`, `server.py`, `database.js`, `keyboard.js`/`dictionary.js`, `body-map.js`, hit-testing, or the dwell FSM's behaviour around time gaps, re-arming and element edges. **Every High bug in §4 sits in untested code.**

---

## 4. Bugs, ranked by severity

**Severity scale**

| Level | Meaning |
|---|---|
| **Critical** | Patient safety or health-data exposure that can occur in normal use |
| **High** | A core function (communicating, alarming, recording) is broken, or the UI gives misleading safety information |
| **Medium** | Degrades reliability, accuracy or data integrity; a workaround exists |
| **Low** | Robustness, maintainability or cosmetic |

### 4.0 Overview

| ID | Severity | Finding | Location | Evidence |
|---|---|---|---|---|
| C1 | Critical | Server exposes health data and safety settings to the local network | [server.py:370-371](server.py#L370-L371), [server.py:238-355](server.py#L238-L355) | Reproduced |
| C2 | Critical | Gaze can press the alarm's "CAREGIVER CONFIRMED" button and "Stop Gaze Camera" | [gaze-engine.js:427](gaze-engine.js#L427) | Code + measured hit-test |
| H1 | High | Dwell completes on the first frame after a tracking gap | [gaze-engine.js:373-382](gaze-engine.js#L373-L382), [gaze/dwell-controller.js:146](gaze/dwell-controller.js#L146) | Reproduced |
| H2 | High | "API webhook sent" is false | [index.html:255](index.html#L255) | Code |
| H3 | High | Monitoring stops silently (hidden tab, camera unplugged, face absent) | [gaze-engine.js:153-244](gaze-engine.js#L153-L244) | Code |
| H4 | High | Body map cannot be used by gaze (SVG has no `click()`) | [app.js:179](app.js#L179) | Reproduced (Chrome 153) |
| H5 | High | Overlapping body zones select the wrong part | [body-map.js:10-21](body-map.js#L10-L21) | Reproduced |
| H6 | High | Autocorrect silently changes meaning | [keyboard.js:82-93](keyboard.js#L82-L93) | Reproduced |
| H7 | High | Stored XSS in the caregiver dashboard | [app.js:463-472](app.js#L463-L472) | Reproduced in part |
| H8 | High | TTS prefers online voices; failures are silent | [voice.js:41-42](voice.js#L41-L42) | Suspected |
| M1 | Medium¹ | Calibration quality report is not a reliable accuracy estimate | [gaze/gaze-calibration.js:193-228](gaze/gaze-calibration.js#L193-L228) | Reproduced (synthetic) |
| M2 | Medium | Head movement after calibration → large errors, undetected | [gaze-engine.js:329-339](gaze-engine.js#L329-L339) | Reproduced (synthetic) |
| M3 | Medium | The same target re-fires while gaze stays on it | [gaze/dwell-controller.js:99-113](gaze/dwell-controller.js#L99-L113) | Reproduced |
| M4 | Medium | One frame outside a target resets the dwell to 0 | [gaze/dwell-controller.js:93-96](gaze/dwell-controller.js#L93-L96) | Reproduced |
| M5 | Medium | Dwell clicks are active before calibration | [gaze-engine.js:385-387](gaze-engine.js#L385-L387) | Code |
| M6 | Medium | Cancelled/failed recalibration discards the working model; poor ones auto-save | [gaze-engine.js:477-480](gaze-engine.js#L477-L480) | Code |
| M7 | Medium | Each alarm is logged 2×, each Nurse Call 3× | [gaze-engine.js:467](gaze-engine.js#L467), [app.js:194](app.js#L194), [keyboard.js:159](keyboard.js#L159) | Measured |
| M8 | Medium | Logs are silently lost when the server is unreachable | [database.js:162-168](database.js#L162-L168) | Code |
| M9 | Medium | Urgent phrases ("Call nurse", "I can't breathe") neither alert nor log | [phrases.js:3](phrases.js#L3), [phrases.js:28](phrases.js#L28) | Code |
| M10 | Medium | Drift detector almost never fires, and its warning is overwritten | [gaze/drift-detector.js:16](gaze/drift-detector.js#L16) | Reproduced |
| M11 | Medium | Prolonged-closure alarm repeats every 15 s while asleep; no rest mode | [gaze-engine.js:442-447](gaze-engine.js#L442-L447), [gaze-engine.js:469](gaze-engine.js#L469) | Code |
| M12 | Medium | Service worker serves stale code; MediaPipe WASM not cached | [sw.js:3-28](sw.js#L3-L28), [sw.js:48-52](sw.js#L48-L52) | Code |
| M13 | Medium | `validate.py` (CI) tests v3, fails, and writes to the v1 database | [validate.py:91-118](validate.py#L91-L118) | Reproduced (on a copy) |
| L1–L12 | Low | See §4.4 | | |

¹ Medium for patients. For the dissertation treat M1 as **High**: do not quote the in-app numbers as accuracy.

### 4.1 Critical

**C1 — The server exposes health data and safety settings to the local network.**
- **What:**
  - `server.py` listens on **all interfaces** ([server.py:371](server.py#L371): `("0.0.0.0", port)`) and has no authentication.
  - Its static handler is rooted at the project folder ([server.py:370](server.py#L370)), so it serves every file there, including dotfiles, and generates directory listings.
  - API responses carry `Access-Control-Allow-Origin: *` ([server.py:247](server.py#L247)).
  - `POST` is accepted with `Content-Type: text/plain`, which browsers send cross-site without a CORS preflight.
- **Consequences:** anyone who can reach port 8000 (same Wi-Fi or ward network) can:
  - download `lumiiq.db`, `lumiiq.db-wal` and `eyecare.db`, which contain typed messages, symptoms, alerts and calibration;
  - download any file in the folder, e.g. `archive/platform/.env`;
  - read (`GET /api/logs`) or wipe (`DELETE /api/logs`) the alert history;
  - change safety settings with `PUT /api/settings`:
    - `alarmVolume: 0` silences the siren;
    - `earThreshold: 0.99` makes every frame read as "eyes closed", so alarms fire constantly;
    - `dwellTimeMs: "abc"` stops dwell from ever completing;
  - replace the calibration with `PUT /api/calibration`.
- **Why it matters:** typed messages and symptoms are health data (UK GDPR special category), and the alarm settings are safety controls.
- **Evidence (Reproduced):** a copy of `server.py`, bound to 127.0.0.1 in a scratch folder, did all of the following: served the database file (`SQLite format 3`), a dotfile and a directory listing; stored a `text/plain` POST verbatim; returned `ACAO: *`; accepted the settings above; and cleared the logs (Appendix A.4).
- **Repro:** Appendix A.4. Use a throwaway copy, never the real folder.

**C2 — Gaze can press the alarm's "CAREGIVER CONFIRMED" button and "Stop Gaze Camera".**
- **What:**
  - `_hitTest` accepts `.gazeable`, **any `<button>`**, or any link ([gaze-engine.js:427](gaze-engine.js#L427)).
  - The dwell loop keeps running while the emergency overlay is visible.
  - The overlay's "CAREGIVER CONFIRMED — Dismiss" button ([index.html:256](index.html#L256)) is therefore dwell-clickable. It measures 385×51 px at the screen centre. Its handler hides the overlay and stops the siren ([app.js:239-246](app.js#L239-L246)).
  - Likewise, the Caregiver tab is `.gazeable` ([index.html:37](index.html#L37)), and "Start/Stop Gaze Camera" is a `<button>` that calls `stopCamera()` when tracking is on ([app.js:254-259](app.js#L254-L259)). Once the camera stops there is no tracking and no alarm detection, and the patient cannot restart it.
- **Why it matters:** the patient's gaze, or drifting gaze, can silence an alarm that claims a caregiver confirmed it, or switch monitoring off. Both failures are silent.
- **Evidence:** the code path above. In headless Chrome at 1280×720, 1440×900 and 1920×1080, `elementFromPoint` at the dismiss button's centre returns the button. Not yet reproduced with a live webcam.
- **Repro (with a webcam):**
  1. Start the camera and calibrate.
  2. Trigger an alarm: blink 6 times within 3 s, or dwell on Nurse Call.
  3. Look at the red "CAREGIVER CONFIRMED" button for about 1.4 s. The overlay closes and the siren stops.
  4. Dwell on "⚙ Caregiver", then on "Stop Gaze Camera". The status becomes "Tracking stopped."

### 4.2 High

**H1 — A dwell completes on the first frame after a tracking gap.**
- **What:** when a frame has no face ([gaze-engine.js:218](gaze-engine.js#L218)), closed eyes ([:373-376](gaze-engine.js#L373-L376)) or confidence below 0.2 ([:379-382](gaze-engine.js#L379-L382)), the engine returns *before* `dwell.update()`.
  - The FSM keeps its `DWELLING` state and start time.
  - Progress is computed from elapsed clock time ([gaze/dwell-controller.js:146](gaze/dwell-controller.js#L146)).
  - So on the first frame after the gap, if gaze is still on the same target, progress jumps to 1 or more and the target fires with no visible build-up.
- **Why it matters:** any closure longer than the remaining dwell time activates whatever the user was looking at. At half progress with the default 1200 ms, that is 0.6 s; your stored setting is 600 ms. During the gap, the ring also shows stale progress.
- **Evidence (Reproduced, A.1 R1):** progress 0.19, then a 2 s gap, then a single frame on the same key → the key fires.
- **Repro (with a webcam):** look at a key until the ring starts, close your eyes for about 2 s, then open them still looking at the key. It fires immediately.

**H2 — "API webhook sent" is false.**
- **What:**
  - The alarm overlay says "Caregiver alarm is sounding. API webhook sent." ([index.html:255](index.html#L255)).
  - No webhook exists. [app.js:196](app.js#L196) only calls `console.warn('[ALERT API] Would POST to caregiver webhook…')`.
  - [server.py:189](server.py#L189) just stores the row; its comment says "Real systems would forward this".
- **Why it matters:** a caregiver reading the screen can reasonably believe remote staff were notified.
- **Repro:** open DevTools → Network and trigger any alarm. The only request is `POST /api/logs/alert` to the local server.

**H3 — Safety monitoring stops silently.**
- **What:** three situations go unhandled (a search for `visibilitychange`, track `ended` and `devicechange` finds nothing):
  - **Hidden tab or minimised window:** frame callbacks pause, so no closure or blink alarm can fire.
  - **Camera track ends** (USB unplugged, permission revoked): new frames stop, the loop goes quiet, and the status pill keeps its last text.
  - **Face absent:** this only hides the cursor ([app.js:114-117](app.js#L114-L117)). There is no timeout alarm, although [research_and_brainstorm.md:118](research_and_brainstorm.md#L118) lists a "Face missing ≥ 5 s" response.
- **Why it matters:** the system's safety role fails in common situations, and nobody is told.
- **Repro:** start the camera, switch to another tab for 10 s with your eyes closed, then come back. No alarm fires. Or unplug a USB webcam: nothing reports it.

**H4 — The body map cannot be operated by gaze.**
- **What:**
  - The body zones are SVG `<ellipse class="body-zone gazeable">` elements ([body-map.js:67-72](body-map.js#L67-L72)). The hit-test finds them and the FSM completes, then `_onDwellClick` calls `el.click()` ([app.js:179](app.js#L179)).
  - `click()` exists only on HTML elements, so it throws `TypeError: el.click is not a function`.
  - The frame loop's `catch` swallows the error and logs "Frame error" ([gaze-engine.js:220](gaze-engine.js#L220)).
  - The ring completes and nothing is selected. This repeats every ~1.85 s while the user keeps looking (M3).
  - Mouse clicks work, which is why desk testing doesn't reveal the problem.
- **Evidence (Reproduced):** in headless Chrome 153, `typeof ellipse.click` is `"undefined"` and calling it throws.
- **Repro:** on the Body Map tab, run `typeof document.querySelector('.body-zone').click` in the DevTools console. It returns `"undefined"`.

**H5 — Overlapping body zones select the wrong body part.**
- **What:**
  - Zones are painted in array order, later ones on top ([body-map.js:10-21](body-map.js#L10-L21), [:65-78](body-map.js#L65-L78)).
  - "Back" is painted last and covers the middle of "Chest" and "Stomach". "Eyes" covers the middle of "Head".
  - 43% of the chest's area and 60% of the stomach's are covered by a zone painted over them.
  - The rendered zones don't scale with the screen: "Eyes" is 46×23 px and "Back" 49×114 px.
- **Why it matters:** a patient aiming at the chest reports "Back". Chest pain vs back pain is a clinically meaningful mis-report.
- **Evidence (Reproduced, A.2):** zone geometry, plus the browser's hit-test at the chest centre returning `zone_back`.
- **Repro:** on the Body Map tab, click the centre of the chest with the mouse. The panel shows "Back (पीठ)".

**H6 — Autocorrect silently changes meaning.**
- **What:**
  - Each SPACE replaces the last word with the closest vocabulary word within edit distance 2 ([keyboard.js:82-93](keyboard.js#L82-L93), [dictionary.js:150-176](dictionary.js#L150-L176)), with no confirmation and no undo.
  - Tested on the real dictionary: CANT→Want, DONT→Door, HOME→Some, LOVE→Move, SICK→Sit, OK→Or, TV→I, KIDS→Is, JOHN→Son, ANNA→An, WIFI→Wife, NEEDS→Need.
  - The correction reruns on every SPACE, so these words **cannot be typed mid-sentence**; they only survive as the final word before SPEAK.
- **Why it matters:** an AAC system must not change the meaning of what the user writes. "I CANT" becoming "I Want" inverts it.
- **Repro:** on the Keyboard tab, type C, A, N, T, SPACE. The display shows "Want ".

**H7 — Stored XSS in the caregiver dashboard.**
- **What:**
  - `_refreshLogs` puts `text`, `bodyPart`, `symptom`, `type` and `details` into `innerHTML` through template strings, without escaping ([app.js:463-464](app.js#L463-L464), [:470-472](app.js#L470-L472)).
  - Through C1, anyone on the network can store a script payload. So can any web page that sends a `text/plain` POST, subject to the browser's local-network protections, which vary by version and should not be relied on.
- **Evidence:**
  - Reproduced: the payload `<img src=x onerror=…>` was stored and returned verbatim (A.4).
  - By code reading: the rendering step would execute it.
- **Repro:** POST the payload to a throwaway copy of the server (A.4), then open the Caregiver tab.

**H8 — Speech prefers online voices, and failures are silent** (Suspected).
- **What:**
  - `_pickVoice` picks any voice whose name matches "google", "natural", "neural", "premium" or "enhanced" *before* preferring on-device (`localService`) voices ([voice.js:41-42](voice.js#L41-L42)).
  - To my knowledge, Chrome's "Google …" voices and Edge's "… Online (Natural)" voices are server-based. If so:
    - (a) without internet the utterance fails with no sound, and there is no `onerror`/`onend` handling ([voice.js:50-75](voice.js#L50-L75));
    - (b) the patient's messages are sent to a cloud speech service.
  - Separately, `speechSynthesis.cancel()` runs before every new utterance ([voice.js:54](voice.js#L54)), cutting off a message that is still being spoken.
- **Verify (2 minutes):**
  1. In the Chrome console run `speechSynthesis.getVoices().filter(v => /google|natural/i.test(v.name)).map(v => [v.name, v.localService])`.
  2. Turn Wi-Fi off and press SPEAK.

### 4.3 Medium

**M1 — The calibration quality report is not a reliable accuracy estimate.**
- **What:**
  - After calibrating, the app shows Quality (Excellent/Good/Fair/Poor), "Confidence %" and "Est. Accuracy ~N px" ([app.js:412-418](app.js#L412-L418)).
  - All three come from 5-fold cross-validation with **interleaved folds** (`folds[i] = i % k`, [gaze/ridge-regression.js:309](gaze/ridge-regression.js#L309)). Consecutive frames of the *same target* land in both the training and the test folds, so the test never uses an unseen screen position.
  - "Confidence" is R² × 100, not a probability ([gaze/gaze-calibration.js:220](gaze/gaze-calibration.js#L220)).
  - The rating thresholds are on R² ([gaze/gaze-calibration.js:94-99](gaze/gaze-calibration.js#L94-L99)). R² depends on how spread out the targets are, so R² = 0.90 on both axes still allows about **156 px horizontal and 97 px vertical RMS error** on a 1440×900 viewport with a 3×3 grid (≈135/85 px with 5×5).
  - The code comments call this "honest (non-overfit)" ([gaze/gaze-calibration.js:203](gaze/gaze-calibration.js#L203), [gaze/ridge-regression.js:300-302](gaze/ridge-regression.js#L300-L302)).
- **Evidence (Reproduced on synthetic data, A.3; table in §5.5):**
  - "Excellent" in 8 of 8 scenarios.
  - The reported error vs the error at new positions is 1.0–1.35× when head behaviour is the same during calibration and use, and **2.4–5.0×** when the head followed the targets during calibration but not in use.
  - Your stored calibrations: 25 points, λ = 0.01 on both axes (the grid minimum), "Good · 88% · ~180 px" (`lumiiq.db`) and "Excellent · 97% · ~89 px" (`eyecare.db`).
- **Why it matters:** users are told tracking is "Excellent / ready" almost regardless of quality. For the dissertation, these figures are not accuracy measurements and must not be quoted as such.

**M2 — Head movement after calibration causes large, undetected errors** (a design limitation more than a bug).
- **What:**
  - Head pose enters only as regression features: yaw, pitch, roll, face scale and inter-pupil distance ([gaze-engine.js:329-339](gaze-engine.js#L329-L339)).
  - If the head is still during calibration, these columns have tiny variance. Z-scoring divides by that tiny spread, and the degree-2 terms square the result.
  - So a modest head turn in use becomes a large extrapolation, and nothing checks whether the current features lie inside the calibrated range.
- **Evidence (Reproduced, synthetic, A.3):** after a head-still calibration, with gaze held on the screen centre, turning the head 0/2/5/10° gave RMS errors of 115/205/563/745 px (9 points) and 117/142/701/849 px (25 points). For comparison, a model that ignored head pose altogether would be off by about 240 px at 5° in this generator.
- **Your stored calibration** shows a yaw spread of 6.2°, i.e. your head moved during calibration. That confounds head and eye movement: in synthetic scenario C, the reported 68–97 px became 234–343 px once only the eyes moved.

**M3 — The same target re-fires while gaze stays on it.**
- **What:** after the 600 ms cooldown the FSM is IDLE with no current target, so the same element counts as new ([gaze/dwell-controller.js:88](gaze/dwell-controller.js#L88), [:99-113](gaze/dwell-controller.js#L99-L113)). Re-arming never requires looking away.
- **Evidence (Reproduced, A.1 R2):** 10 s of steady gaze on one key produced 5 activations, at 1254, 3102, 4950, 6798 and 8646 ms.
- **Effect:** repeated letters, repeated SPEAK (duplicate speech and logs), repeated Nurse Call.

**M4 — One frame outside a target resets the dwell to 0.**
- **What:**
  - If the hit-test returns another element or nothing, the FSM aborts immediately ([gaze/dwell-controller.js:93-96](gaze/dwell-controller.js#L93-L96), [:99-113](gaze/dwell-controller.js#L99-L113)).
  - Hysteresis exists only around the gaze anchor (enter 45 px / cancel 90 px), not at the element's edge, and there is no grace period.
  - Keys are separated by 8 px gaps (measured), so jitter near an edge restarts the dwell repeatedly.
- **Evidence (Reproduced, A.1 R4):** progress 0.78, one frame 30 px outside the key, back on the key → progress 0.

**M5 — Dwell clicks are active before calibration.** Uncalibrated, `_fallbackMap` (a fixed gain of 2.2 around the eye centre, [gaze-engine.js:407-416](gaze-engine.js#L407-L416)) drives the full dwell pipeline ([:385-387](gaze-engine.js#L385-L387)). Nothing gates activations, so on first start any target (Nurse Call, tabs, Stop camera) can fire from a crude mapping.

**M6 — A cancelled or failed recalibration discards the working model, and poor calibrations save automatically.**
- **What:**
  - `startCalibration` replaces the trained model with an empty one and sets `isCalibrated = false` ([gaze-engine.js:477-480](gaze-engine.js#L477-L480)).
  - Cancelling sets it to `null` ([:524](gaze-engine.js#L524)), and a failed training run leaves it unusable. Either way the previous good model is gone until reload, and the cursor falls back to M5.
  - Any successful training, including "Poor", is saved to the server and to `localStorage` at once ([:507](gaze-engine.js#L507)). That overwrites the previous calibration before the user presses Accept or Recalibrate ([app.js:306-313](app.js#L306-L313)).
- **Repro:** calibrate, open calibration again, press Exit. The cursor now uses the fallback map.

**M7 — Every alarm is logged twice and every Nurse Call three times.**
- **What:**
  - `_triggerEmergency` logs the alert ([gaze-engine.js:467](gaze-engine.js#L467)), and `EyeApp._onEmergency` logs it again ([app.js:194](app.js#L194)).
  - Nurse Call adds a third row ([keyboard.js:159](keyboard.js#L159)).
- **Evidence (Measured):**
  - `eyecare.db` has 38 alert rows representing 16 events: 6 Nurse Calls × 3 and 10 rapid-blink alarms × 2, with rows 0–7 ms apart.
  - `lumiiq.db` has 2 rows for 1 event.
- **Effect:** the caregiver timeline and any alarm statistics are inflated 2–3×. Query in A.5.

**M8 — Logs are silently lost when the server is unreachable.**
- **What:**
  - `_post` is fire-and-forget with `.catch(() => {})` ([database.js:162-168](database.js#L162-L168)), and logs live only in memory.
  - The file header ([database.js:6](database.js#L6)) says "Every write is mirrored to localStorage", and [README.md:22-24](README.md#L22-L24) promises a fallback. Only settings and calibration are actually mirrored.
- **Effect:** if the server is down, typed messages, symptoms and alerts disappear on the next reload, and nobody is told.

**M9 — Urgent phrases neither alert nor log.** The "Urgent" phrases ("I need help", "Call nurse", "I can't breathe", "I'm in pain", [phrases.js:3](phrases.js#L3)) only speak ([phrases.js:28](phrases.js#L28)). There is no alert, no siren and no log entry, unlike keyboard SPEAK (which logs) and Nurse Call (which alerts).

**M10 — The drift detector almost never fires, and its warning is overwritten.**
- **What:**
  - It flags drift when the mean normalised distance from the element's centre over the last ≤ 20 activations exceeds 0.6 ([gaze/drift-detector.js:16](gaze/drift-detector.js#L16)).
  - Activations only happen with the gaze *inside* the element, where that distance is at most 0.5 along an edge and 0.71 in a corner.
  - When it does fire, it writes to the status pill ([app.js:173-176](app.js#L173-L176)), which `_onGazeUpdate` overwrites on the very next frame ([app.js:111-139](app.js#L111-L139)).
- **Evidence (Reproduced, A.1 R5):** after 20 accurate dwells, it takes 18 consecutive corner-level misses to flag. 20 dwells on a key's edge never flag.

**M11 — The prolonged-closure alarm repeats every 15 s while the eyes stay closed.**
- **What:** at 3 s of closure the alarm fires. The flag resets after 15 s ([gaze-engine.js:469](gaze-engine.js#L469)), and because the eyes are still closed, the next frame fires it again ([:442-447](gaze-engine.js#L442-L447)).
- There is no rest or sleep mode. The only way to stop it is to stop the camera, which disables monitoring (C2, H3).
- **Why it matters:** alarm fatigue. This needs a design decision, not just a fix.

**M12 — The service worker serves stale code, and the MediaPipe WASM is not cached.**
- **Stale code:** the worker serves from its cache first and never revalidates ([sw.js:48-52](sw.js#L48-L52); the file's own comment warns about this). After any code change, a browser that already has the old worker keeps running the old JavaScript until `CACHE_NAME` changes ([sw.js:3](sw.js#L3)).
  - **This threatens Phase 1–2 validity:** a recording could be made with stale code.
- **WASM not cached:** MediaPipe's WASM files (`lib/mediapipe/wasm/vision_wasm_internal.{js,wasm}` and the `nosimd` variants) are missing from the cache list ([sw.js:4-28](sw.js#L4-L28)). If the local server isn't running, the installed app cannot start gaze tracking.

**M13 — `validate.py` (the second CI step) tests the wrong codebase and writes to the v1 database.**
- **What:**
  - It checks the v3 backend and the moved `frontend/` ([validate.py:64-78](validate.py#L64-L78), [:193-216](validate.py#L193-L216)); it never tests v1.
  - It fails: 1/7 checks on Python 3.14, 4/7 on 3.11.
  - Its database check calls the v3 `init_db()` ([validate.py:96-102](validate.py#L96-L102)). That runs `create_all` against the **root `lumiiq.db`** ([backend/app/database/database.py:12](backend/app/database/database.py#L12)).
  - Run in place, it would add v3 tables to the live v1 database. Run on my copy, it created a new database next to the copy.

### 4.4 Low

| ID | Finding | Location | Evidence |
|---|---|---|---|
| L1 | Dwell progress is not monotonic. The engine rescales dwell time every frame (×1.3 / ×2.0 by smoothed confidence), and the FSM rescales it again by jitter (×0.85–1.15), so the ring jumps (0.39 → 0.21 → … → 0.49) | [gaze-engine.js:398-402](gaze-engine.js#L398-L402), [gaze/dwell-controller.js:65-71](gaze/dwell-controller.js#L65-L71) | Reproduced (A.1 R3) |
| L2 | The server stores any settings keys and types without validation. `dwellTimeMs: "abc"` makes progress NaN, so dwell never fires | [server.py:124-133](server.py#L124-L133) | Reproduced (A.4) |
| L3 | The "Sensitivity X/Y" sliders do nothing; the engine never reads them | [index.html:139-152](index.html#L139-L152), [database.js:17-18](database.js#L17-L18) | Code |
| L4 | The status pill shows "No face detected" for every no-gaze state (eyes closed, low confidence, calibrating), and alarm or drift messages are overwritten on the next frame | [app.js:114-117](app.js#L114-L117) | Code |
| L5 | Error handling. Every `getUserMedia` failure is reported as "Camera permission denied". An init failure says "Check internet" although all assets are local. The GPU delegate has no CPU fallback. There is an empty `catch` | [gaze-engine.js:188](gaze-engine.js#L188), [:107](gaze-engine.js#L107), [:81](gaze-engine.js#L81), [:176](gaze-engine.js#L176) | Code |
| L6 | Calibration timing. Capture starts exactly when the 500 ms overshooting dot animation ends, leaving no margin for the corrective saccade. The time hints are wrong (9 points "~25 s", actual ≈ 14–15 s plus retries). The intro text says "5-point" while the default is 9 | [app.js:341-342](app.js#L341-L342), [:278-279](app.js#L278-L279), [index.html:77](index.html#L77) | Code |
| L7 | No blink or emergency detection runs during calibration | [gaze-engine.js:360-368](gaze-engine.js#L360-L368) | Code |
| L8 | Calibration training blocks the main thread: 74 / 92 / 164 / 259 ms for 5 / 9 / 16 / 25 points (Node, this Mac) | [gaze/gaze-calibration.js:193-228](gaze/gaze-calibration.js#L193-L228) | Measured |
| L9 | Google Fonts are fetched from `fonts.googleapis.com` on every load: the user's IP goes to a third party, and the fonts are missing offline (cosmetic) | [styles.css:6](styles.css#L6) | Code |
| L10 | `dlib_tracker.py` downloads a 100 MB model with TLS verification disabled and an `http://` fallback. The app never uses it | [dlib_tracker.py:17-35](dlib_tracker.py#L17-L35) | Code |
| L11 | A double click, or dwell plus click, can run `init()` twice (two landmarkers, duplicate listeners) or start a second frame loop | [app.js:254-268](app.js#L254-L268), [gaze-engine.js:126-134](gaze-engine.js#L126-L134) | Code |
| L12 | Documentation and comments are out of date (§7) | — | Code |

---

## 5. Gaze pipeline analysis

### 5.1 Features fed to the regression

The code's "L" and "R" are image sides: L is the subject's right eye. The iris and eye-corner landmarks are paired consistently.

| # | Feature | Definition | Landmarks |
|---|---|---|---|
| 0, 2 | `lx`, `rx` | Horizontal iris position within the eye: (iris.x − corner₁.x) / (corner₂.x − corner₁.x) | 468 with 33/133; 473 with 362/263 |
| 1, 3 | `ly`, `ry` | Vertical iris position between the eyelids: (iris.y − upper.y) / (lower.y − upper.y) | 468 with 159/145; 473 with 386/374 |
| 4–6 | `yaw`, `pitch`, `roll` | Euler angles (degrees) from MediaPipe's 4×4 facial transform, assumed column-major ([gaze-engine.js:271-288](gaze-engine.js#L271-L288)) | — |
| 7 | `ear` | Mean eye opening: one vertical pair divided by the corner distance, per eye | 159/145/33/133; 386/374/362/263 |
| 8 | `faceScale` | Distance between the outer eye corners (normalised image units): a proxy for distance to the camera | 33, 263 |
| 9 | `ipd` | Distance between the iris centres; nearly collinear with `faceScale` | 468, 473 |

Points you should be able to defend:
- **The signal is tiny.** In your stored calibration, the iris ratios have a standard deviation of only **0.03–0.04 across the whole screen**. The full screen maps onto a few hundredths of the eye's width, so landmark jitter of about 0.01 is a large fraction of the signal. This is the basic limit of webcam iris tracking, and it is why smoothing and dwell design matter so much.
- **Vertical gaze is measured against the eyelids,** and the lids themselves follow vertical gaze. Part of the signal cancels, so vertical accuracy is usually worse. Your stored report agrees: R² of 0.83 for y vs 0.93 for x.
- **Head roll is not compensated.** The ratios use x-only and y-only differences, so a tilted head mixes horizontal and vertical movement.
- **`ear` as a regression input** couples blinks and fatigue into the gaze estimate.
- **Single-eye substitution changes the input distribution.** When one eye is below the blink threshold, the other eye's ratios are copied into its slots ([gaze-engine.js:319-327](gaze-engine.js#L319-L327)), so the model sees inputs unlike its both-eyes calibration.

### 5.2 Polynomial expansion and normalisation

- **Expansion:** degree 2 gives 10 linear terms plus 55 squares and cross-products, so **65 terms, plus an intercept: 66 weights per axis**. There are two independent models, one for x and one for y. The stored models do have 66 weights.
- **Order of operations:** the expansion happens *before* standardisation, with no centring first. For a feature far from zero, x and x² are nearly collinear: for `lx` ≈ 0.5 ± 0.03 their correlation is about 0.999. Ridge copes with that, but it means individual weights have no useful interpretation.
- **Standardisation:** z-score each of the 65 columns using the calibration mean and (population) standard deviation. Constant columns get a standard deviation of 1.
  - **Near-constant columns are the danger.** Head pose, `faceScale` and `ipd` barely vary in a head-still calibration: your stored `faceScale` std is 0.0087 and `ipd` 0.0060. Dividing by those amplifies small changes in use (M2).
- **Clamping:** predictions are clamped to [0, 1] ([gaze/gaze-calibration.js:231-237](gaze/gaze-calibration.js#L231-L237)), which hides extrapolation. The Phase 1 logger should record the unclamped value as well.

### 5.3 Regularisation and solver

- **Objective:** minimise ‖1·w₀ + Zw − y‖² + **λ·n**·‖w‖², where n is the number of training rows and the intercept w₀ is not penalised.
  - Scaling λ by n makes the same λ mean the same thing whatever the sample count.
  - It is solved as least squares on the stacked system [Z; √(λn)·I] with Householder QR ([gaze/ridge-regression.js:236-260](gaze/ridge-regression.js#L236-L260)). QR is more stable than forming ZᵀZ.
  - The comments at [:15](gaze/ridge-regression.js#L15) and [:212](gaze/ridge-regression.js#L212) still describe the normal equations, and [research_and_brainstorm.md:87](research_and_brainstorm.md#L87) says Gauss–Jordan (§7).
- **Choosing λ:** from the grid {0.01, 0.05, 0.2, 1, 5, 20}, picked separately for x and y by interleaved 5-fold CV R² ([:304-336](gaze/ridge-regression.js#L304-L336)).
- **The grid's lower edge is doing the work.** Both of your stored calibrations chose **λ = 0.01 on both axes**, the smallest value available. In the synthetic sweep, 13 of 16 selections were also 0.01. When the chosen value sits at the edge of the grid, "tuned by cross-validation" really means "the smallest value allowed". And because the CV leaks (M1), it systematically favours weak regularisation.

### 5.4 Calibration protocol and layout

- **Point counts:** 5, 9, 16 or 25; 9 is the default.
  - The 5-point layout is the centre plus 4 corners, with no edge midpoints.
  - The grids are 3×3, 4×4 and 5×5, spanning **8% to 92%** of the viewport and visited in snake order ([gaze/gaze-calibration.js:26-55](gaze/gaze-calibration.js#L26-L55)).
- **Per point** ([app.js:341-388](app.js#L341-L388)):
  - The dot moves over 500 ms, with an overshooting ease.
  - For 500 ms of "settle", samples are discarded.
  - For 1100 ms of capture, about 33 frames are collected at 30 fps.
  - If fewer than 12 frames were captured, the point is retried.
  - MAD outlier rejection then drops any frame that is more than 4 MAD out in more than 30% of the 10 dimensions. At most 24 frames are kept, evenly subsampled.
- **Frames that get through:**
  - With one eye closed, the frame is kept with the substituted vector.
  - Partly closed eyes above the threshold are kept.
  - A typical blink-onset frame distorts `ly`, `ry` and `ear`: 3 of 10 dimensions, i.e. exactly 30%, which the filter lets through.
- **Coverage (measured at 1440×900):** calibrated targets span x 115–1325 and y 72–828 px.
  - The header tabs (y 9–55) are **outside** that band.
  - Nurse Call (x 1236–1416) is **half outside** it.
  - The same holds at 1280×720 and 1920×1080.
- **Information vs parameters:** 5–25 distinct target positions against 66 weights per axis. The frames within one target are near-duplicates, so the mapping is only pinned down by regularisation and clamping.
- **Your stored calibrations:** 25 points and 561 / 589 frames, i.e. about 22–24 kept per point.

### 5.5 The calibration quality report

These numbers are on **synthetic** data run through the real modules (A.3). They show how the estimator behaves; they say nothing about the app's accuracy on a person. Errors are RMS pixels on a 1440×900 screen.

| Scenario | Points | App reports | Leave-one-target-out | New positions | λx / λy | App's rating |
|---|---|---|---|---|---|---|
| A · head still, fixation sd 0.5°, jitter 0.008 | 9 | 123 | 129 | 136 | 0.2 / 0.01 | Excellent (95%) |
| | 25 | 122 | 123 | 120 | 0.01 / 0.2 | Excellent (94%) |
| B · head still, fixation sd 1.5°, jitter 0.004 | 9 | 108 | 152 | 139 | 0.01 / 0.01 | Excellent (96%) |
| | 25 | 107 | 122 | 133 | 0.01 / 0.01 | Excellent (95%) |
| C · head follows targets in calibration, eyes only in use | 9 | 68 | 83 | 343 | 0.01 / 0.05 | Excellent (98%) |
| | 25 | 97 | 111 | 234 | 0.01 / 0.01 | Excellent (95%) |
| D · head follows targets in calibration and in use | 9 | 78 | 162 | 105 | 0.01 / 0.01 | Excellent (98%) |
| | 25 | 92 | 105 | 94 | 0.01 / 0.01 | Excellent (96%) |

How to read the table honestly:
- **The in-app figure is optimistic, by a variable amount.** When per-frame noise dominates (A), the leak barely matters. With more fixation error (B), the reported figure is 1.2–1.3× too low. When head behaviour differs between calibration and use (C), no cross-validation can see the problem: 2.4–5.0× too low.
- **Leave-one-target-out is not the fix either.** It is pessimistic at corners, because predicting a held-out corner requires extrapolation; see D at 9 points.
- **The right yardstick is separate validation targets** shown after calibration. That belongs in Phase 1.
- **The rating never discriminated:** "Excellent" in all 8 scenarios.

### 5.6 Head pose

- **How head pose is handled:**
  - Head pose is used only as input features, plus a confidence penalty beyond |yaw| > 25° or |pitch| > 20° ([gaze-engine.js:262-265](gaze-engine.js#L262-L265)).
  - There is no geometric compensation, no normalisation of the iris features by head rotation, and no check for leaving the calibrated head range.
- **Synthetic evidence** (M2): after a head-still calibration, a 5° head turn gave 563–701 px of error, compared with about 240 px if head pose were ignored altogether. Head-pose features learned from a head-still calibration made head turns *worse* than having no head-pose features at all.
- **Your real calibration had the head moving** (yaw std 6.2°). That is the confounded case C.
- **Unverified assumption:** the transform matrix is assumed to be column-major ([gaze-engine.js:273](gaze-engine.js#L273)). The vendored type definitions don't say. Phase 1 should confirm the sign of yaw with a deliberate head turn.

### 5.7 Blink handling and safety detection

- **Blink measure:** the eye aspect ratio (EAR) per eye uses one vertical landmark pair over the corner distance, not the usual 6-point EAR.
- **Thresholds:**
  - The EAR threshold defaults to 0.18 (slider 0.10–0.30); **your stored value is 0.11**.
  - The confidence score penalises EAR < 0.12, so frames with EAR in [0.11, 0.12) count as open but low-confidence.
- **Closed-eye frames** produce no prediction and no dwell update (the cause of H1), and the cursor is hidden.
- **Partly closed frames above the threshold** go straight into prediction and filtering. The lid landmarks move during a blink, so `ly`/`ry` spike at blink onset and offset. **There is no rejection window around blinks.**
- **Events:**
  - A closure of 50–800 ms counts as a blink ([gaze-engine.js:450](gaze-engine.js#L450)).
  - ≥ 6 blinks within 3 s → RAPID_BLINKS ([gaze-engine.js:460](gaze-engine.js#L460)).
  - ≥ 3.0 s of closure → PROLONGED_CLOSURE ([gaze-engine.js:445](gaze-engine.js#L445)), which repeats every 15 s (M11).
  - Timing uses `Date.now()`, the wall clock, which can jump.
- **Not implemented** in v1: face-missing and head-droop alarms (H3).

### 5.8 Smoothing

- **Filter:** One-Euro on each axis, in screen pixels.
- **Parameters** come from the smoothing slider value f ∈ [0.05, 0.45] ([gaze-engine.js:141-148](gaze-engine.js#L141-L148)):
  - minCutoff = 3.5 − 4f Hz
  - β = 0.04 − 0.05f
  - dCutoff = 1 Hz
- **Settings in use:**
  - Default f = 0.35 → minCutoff 2.1 Hz, β = 0.0225.
  - **Your stored f = 0.06** → minCutoff 3.26 Hz, β = 0.037: the least smoothing on offer.
- **Consequences:**
  - **The cutoff rises by β × speed:** at the default, 500 px/s adds about 11 Hz.
  - **Noise raises it too.** Fixation noise itself produces speed estimates, so the cutoff during a fixation sits above minCutoff: less jitter suppression than the parameter suggests.
  - **The lag/jitter trade-off at your settings is unmeasured** (Phase 1).
  - **The 2.5 px deadband is negligible** against webcam gaze noise.
  - **No outlier or spike rejection** happens before the filter.
  - **After a tracking gap** the large time step makes the filter jump to the new value: no stale lag.
  - **Calibration uses raw features**, as it should.
- **Stale comment:** [database.js:14](database.js#L14) says a higher smoothing value means "faster", which is the opposite of what the engine does.

### 5.9 Dwell FSM

| From | Condition (checked each frame) | To | Side effect |
|---|---|---|---|
| any | `t < cooldownUntil` | unchanged | Frame ignored ([:88](gaze/dwell-controller.js#L88)) |
| FOCUSING or DWELLING | Hit-test returns nothing | IDLE | Progress 0 ([:93-96](gaze/dwell-controller.js#L93-L96)) |
| any | Hit-test returns a different element | FOCUSING (new element) | Anchor at the gaze point; progress 0 ([:99-113](gaze/dwell-controller.js#L99-L113)) |
| FOCUSING | Gaze drifts > 45 px from the anchor | FOCUSING | Re-anchor, restart the focus timer |
| FOCUSING | Held ≥ 150 ms | DWELLING | Dwell start time = t; re-anchor |
| DWELLING | Gaze drifts > 90 px from the anchor | FOCUSING | Progress 0 |
| DWELLING | (t − start) / effective dwell ≥ 1 | IDLE, plus a 600 ms cooldown | `onActivate` → `el.click()` ([:149-155](gaze/dwell-controller.js#L149-L155)) |

- **Effective dwell time** = the setting (600–2500 ms; default 1200; your stored value 600) × {1, 1.3 or 2.0 by smoothed confidence} × {0.85–1.15 by in-dwell jitter}. That is anywhere from **510 to 5750 ms**.
  - The smoothed confidence only updates on frames that passed the 0.2 gate, and starts at 1.0, so it is biased high ([gaze-engine.js:394](gaze-engine.js#L394)).
- **Hit-testing:** `elementFromPoint` at the filtered point, throttled to 20 Hz (results cached for up to 50 ms). It accepts `.gazeable`, **any button**, or any link (C2).
- **Against the Phase 2 candidates in your brief:**
  - *Hysteresis*: exists only in anchor space, not at element edges (M4).
  - *Refractory period*: exists, but there is no look-away-to-re-arm rule (M3).
  - *Progress feedback*: present, but not monotonic (L1); SVG zones get only a CSS class.
  - *Bounded adaptive time*: bounded only implicitly, by the product above.
  - *Snapping to targets*: absent.
  - *Time-gap handling*: absent (H1).

### 5.10 Coupling between error and target size (measured render, headless Chrome)

| Element | 1280×720 | 1440×900 | 1920×1080 |
|---|---|---|---|
| Letter key (8 px gaps) | 116×103 | 132×148 | 180×193 |
| SPACE | 639×103 | 723×148 | 976×193 |
| Nurse Call | 180×100 | 180×100 | 180×100 |
| Suggestion | 301×58 | 341×58 | 461×58 |
| Nav tab | 141×46 | 141×46 | 141×46 |
| Phrase button | 298×127 | 338×172 | 458×217 |
| Alarm "Dismiss" button | 385×51 | 385×51 | 385×51 |
| Body zones (fixed size) | Eyes 46×23 · Back 49×114 · Arm 46×122 · Head 82×73 · Chest 106×68 | same | same |

- **No real error figure exists yet.** But even the app's own, probably optimistic, figure for your latest calibration (~180 px RMS) is larger than half a letter key (58–90 px depending on the screen).
- **Expect neighbouring-key activations** until the error is reduced or the targets grow.
- **Some targets don't scale:** the suggestion bar, nav tabs, Nurse Call and all body zones stay the same size on any screen.
- **Phase 1's 95th-percentile error will set the minimum reliable target size.**

### 5.11 Questions Phase 1 must answer

1. What are the real accuracy and precision at validation targets *not* used for calibration? The measurement should include the header band and the right edge, where Nurse Call sits.
2. How optimistic is the in-app report on real data? Compare it against held-out validation targets.
3. How large is the error after a deliberate head movement of known size?
4. With the current FSM, how many false activations per minute are there (including the gap-induced H1 and the repeats of M3), how many selections are missed, and how long does a selection take?
5. What are the lag and fixation jitter at the default and at your stored smoothing settings?

---

## 6. Security and privacy scan

### 6.1 Secrets (working tree and git)

- **Working tree:** I pattern-scanned every non-binary file, excluding `node_modules` and `.git`.
  - Patterns covered: Anthropic, OpenAI, AWS, Twilio, Google, GitHub and Slack credentials; private-key blocks; JWTs; password/secret assignments; URLs with embedded credentials.
  - **No API keys, tokens or private keys were found.**
  - There were 5 hits, all development-default database URLs in `archive/platform/` (e.g. user and password both "eyra"; the compose file uses `${VAR:-default}` defaults). All are out of scope.
- **`archive/platform/.env`:** every value is identical to `.env.example`, i.e. placeholders. The Twilio, SMTP, S3, Azure and ElevenLabs keys are empty.
- **Development credentials in `.claude/settings.local.json`:**
  - Line 28 contains a **development admin e-mail and password**, inside a saved command permission for the archived platform's Docker stack.
  - Keep `.claude/settings.local.json` out of any repository, and change that password anywhere it is reused.
- **Git history:**
  - The project root is **not a git repository**, so there is no history to leak and nothing has been pushed.
  - The only repository is `archive/platform/.git`: 0 commits, no remotes, 177 staged files. Its `.gitignore` excludes `.env`, and `.env` is not staged.
  - I scanned the 177 staged blobs directly, since 12 files differ from the working tree. They contain the same 5 dev-default URLs and nothing else.

### 6.2 Personal and health data on disk

| File | Contents (I read counts, categories and timestamps only, never message text) |
|---|---|
| `lumiiq.db` (+ `-wal`, `-shm`) | 1 typed message, 1 symptom report, 2 alert rows (16 Sep 2026); a trained calibration derived from a face; settings |
| `eyecare.db` | 11 typed messages (3–25 characters), 3 symptom reports, 38 alert rows (7 Jun – 25 Jul 2026); a calibration; settings; empty v3 tables |

- Whether this is your own test data or a participant's, **treat both files as personal (possibly health) data**. Never commit them; Phase 5 will need a synthetic sample database.
- Phase 1 recordings will contain time series of facial landmarks, which are biometric-adjacent personal data. Keep them out of git and cover them in your consent paperwork.
- No recordings, images, videos or datasets exist in the tree.
- `__pycache__/` appears at the root and under `backend/`.
- The server prints alert details to its console ([server.py:190](server.py#L190)).

### 6.3 Network exposure and third-party data flows

- **Exposure:** C1 (all interfaces, no auth, whole folder served, `ACAO: *`) and H7 (stored XSS).
- **Third parties:**
  - Google Fonts on every load (L9).
  - Probably a cloud speech service receiving the patient's messages (H8, to be verified).
- Nothing else leaves the machine. MediaPipe and its model are served locally.

### 6.4 Hardcoded paths and environment coupling

- **The runtime code uses relative paths.** `server.py` resolves its own folder.
- **Absolute paths appear only in:**
  - The docs: `/Users/axel/LumiIQ`, which **no longer exists**. It appears in [README.md:33](README.md#L33), [PROJECT.md](PROJECT.md) (lines 9, 28, 62, 90), `SETUP_GUIDE.md`, `SYSTEM_READY.md`, `IMPLEMENTATION_COMPLETE.md`, `README_V3.md` and `docs/IMPLEMENTATION_GUIDE.md`.
  - [start.sh:9](start.sh#L9): `/opt/homebrew/bin/python3.11`.
  - `.claude/settings.local.json:4`.

### 6.5 Large and licensed files

- **`shape_predictor_68_face_landmarks.dat`** is 99.7 MB, just under GitHub's 100 MB per-file limit. It is dlib's 68-point model, trained on iBUG 300-W, whose licence excludes commercial use. Only `dlib_tracker.py` uses it.
- **Vendored MediaPipe files:** `lib/mediapipe/wasm/*.wasm` (9.4 MB and 9.3 MB) and `models/face_landmarker.task` (3.8 MB). Include their licence or model card if you publish.

---

## 7. Documentation vs. code

Quotations below are flagged for correction or removal; they are not claims I make.

| Claim | Where | What the code does |
|---|---|---|
| "state-of-the-art" | [README.md:3](README.md#L3), [package.json:4](package.json#L4) | Unmeasured superlative |
| "never freezes or crashes"; "can never take it down" | [README.md:24](README.md#L24), [:64](README.md#L64) | Unverifiable absolutes (see H4, C1) |
| "`./start.sh` does the same thing" | [README.md:44](README.md#L44) | `start.sh` runs the v3 backend |
| Falls back to `localStorage`; "Every write is mirrored" | [README.md:22-24](README.md#L22-L24), [database.js:6](database.js#L6) | Only settings and calibration are mirrored (M8) |
| "Latency <50ms", "Accuracy: 85%+" | [README_V3.md:141-143](README_V3.md#L141-L143), [IMPLEMENTATION_COMPLETE.md:340-342](IMPLEMENTATION_COMPLETE.md#L340-L342) | Never measured; the accuracy metric is undefined |
| "Large gaze targets (≥40px)" | [README_V3.md:266](README_V3.md#L266), [IMPLEMENTATION_COMPLETE.md:201](IMPLEMENTATION_COMPLETE.md#L201) | Far below the app's own error report (§5.10) |
| "PRODUCTION-READY", "Medical-grade", "hospital-grade", "WCAG AAA" | `SYSTEM_READY.md`, `IMPLEMENTATION_COMPLETE.md`, `README_V3.md`, `SETUP_GUIDE.md`, `docs/IMPLEMENTATION_GUIDE.md` | These v3 documents aren't supported by the code, and WCAG was never audited. Two carry a disclaimer at the top, but the body text still makes the claims |
| "Triple-layer stabilization: One Euro + Kalman + EMA + deadband"; outlier rejection of jumps > 10% | [research_and_brainstorm.md:18](research_and_brainstorm.md#L18), [:99-102](research_and_brainstorm.md#L99-L102) | v1 has One-Euro plus a 2.5 px deadband only |
| Face missing ≥ 5 s → pause and warning; head droop > 45° | [research_and_brainstorm.md:118-119](research_and_brainstorm.md#L118-L119) | Not implemented in v1 (H3) |
| "Gauss-Jordan solver", "8-dim input", (ZᵀZ + λI)⁻¹Zᵀy | [research_and_brainstorm.md:86-91](research_and_brainstorm.md#L86-L91) | QR, 10 dimensions, λ·n with an unpenalised intercept (§5.3) |
| "Anatomical body map ✅ Working" | [research_and_brainstorm.md:22](research_and_brainstorm.md#L22) | Not operable by gaze (H4); zones overlap (H5) |
| "28 assertions", "No Node on this machine"; `platform/` and `frontend/` at the root | [PROJECT.md](PROJECT.md) | 32 assertions; Node 24 is installed; both folders moved to `archive/` |
| Feature vector `[lx, ly, rx, ry, yaw, pitch, roll, ear]` | [gaze-engine.js:8](gaze-engine.js#L8) | 10 features |
| "solved via the normal equations"; (ZᵀZ + λR) w = Zᵀy | [gaze/ridge-regression.js:15](gaze/ridge-regression.js#L15), [:212](gaze/ridge-regression.js#L212) | QR; λ is scaled by n |
| "honest (non-overfit) accuracy estimate" | [gaze/gaze-calibration.js:203](gaze/gaze-calibration.js#L203) | See M1 |
| "Run 5-point calibration … with precision" | [index.html:77](index.html#L77) | The default is 9 points |
| "API webhook sent." | [index.html:255](index.html#L255) | Nothing is sent (H2) |
| "gold-standard", "lightning-fast", "Premium" | [gaze/one-euro-filter.js:4](gaze/one-euro-filter.js#L4), [dictionary.js:3](dictionary.js#L3), [styles.css:1](styles.css#L1) | Opinion. Cite Casiez et al. (CHI 2012) instead of "gold-standard" |

A note on regulation: wording such as "medical-grade" and "safety alarms" can be read as a medical-device intended purpose (in the UK, the MHRA's rules). Describing the artefact as a *research prototype, not a medical device* is safer for the dissertation.

---

## 8. Naming

The same app appears under several names:
- **"LumiIQ":** the page title, `manifest.json`, `package.json`, README and code headers.
- **"EyeCare":** the on-screen brand ([index.html:23](index.html#L23)) and the folder name.
- **"Eyra":** `archive/platform`.
- **"Oculink":** the sibling folder `/Users/axel/Oculink`.

Phase 5 needs your `[NAME]`.

---

## 9. Decisions needed before Phase 1

1. **Scope.** Confirm that the target is the v1 browser app at the root, including `server.py`.
   - Rewriting it in Python/PyQt6 to match the brief would break your "no big-bang rewrite" rule. **I recommend improving v1 as it is.**
   - If a PyQt6 codebase exists somewhere else, tell me its path.
2. **Claude API and Twilio.** Neither exists in v1, although Phase 3 lists their failure modes.
   - **I recommend treating both as out of scope.** The system stays fully offline, and there is less to defend.
   - Remote caregiver notification (the honest version of H2) would be a new feature. Decide on it separately.
3. **Git.** The root is not a repository, so I cannot "work on a branch". My proposal for the start of Phase 1:
   1. Run `git init` locally, with no remote.
   2. First commit: a `.gitignore` excluding `*.db*`, `.env*`, `recordings/`, `__pycache__/`, `.claude/settings.local.json`, `archive/` and the dlib `.dat` file.
   3. Commit the current code as the baseline on `main`, then work on a phase branch.

   Nothing leaves the machine. Do you approve?
4. **Fix C1 early?** Phase 1 needs you to run the app with your webcam. As long as `server.py` listens on all interfaces and serves the whole folder, anyone on your network can read the databases.
   - A minimal fix is small and easy to explain: bind to 127.0.0.1 and serve only the app's files.
   - **Option A:** do that fix before Phase 1.
   - **Option B:** leave it for Phase 3, and record only on a network you trust.
5. **Placeholders** in your brief: `[DATE]`, `[NAME]` and `[BRANCH]`, plus the target thresholds you'll set after Phase 1.

---

## Appendix A — Reproduction

Phase 0 is read-only, so these scripts exist only in this document. Save each as a file and run it with `node` **from the repository root**. They load the real modules and change nothing. In Phase 3 they become regression tests.

### A.1 Dwell FSM (R1–R5)

```js
// node audit-dwell.js   — run from the repository root; loads the real modules, changes nothing.
const { DwellController } = require(require('path').resolve('gaze/dwell-controller.js'));
const { DriftDetector } = require(require('path').resolve('gaze/drift-detector.js'));
const KEY = (x, y) => (x >= 100 && x <= 230 && y >= 100 && y <= 250) ? 'KEY' : null; // ~130x150 px key
let t = 0;
function make(extra) {                       // engine defaults: dwell 1200 ms, adaptive, 150/45/90/600
  const log = { fires: [], p: [] };
  const d = new DwellController(Object.assign({ dwellTime: 1200, adaptive: true, hitTest: KEY,
    onActivate: () => log.fires.push(t), onProgress: (_, p) => log.p.push(+p.toFixed(2)) }, extra));
  return { d, log };
}
{ // R1: no updates for 2 s mid-dwell (the engine skips dwell.update while eyes are closed / face lost)
  const { d, log } = make(); t = 0;
  for (let i = 0; i < 12; i++) d.update(160, 170, t += 33);
  const before = log.p.at(-1);
  d.update(162, 171, t += 2000);
  console.log(`R1 progress ${before}, 2 s gap, one frame on the same key -> activations: ${log.fires.length}`);
}
{ // R2: gaze stays on one key for 10 s
  const { d, log } = make(); t = 0;
  for (let i = 0; i < 300; i++) d.update(160 + (i % 3) - 1, 170, t += 33);
  console.log(`R2 10 s on one key -> ${log.fires.length} activations at ${log.fires.join(', ')} ms`);
}
{ // R3: dwell time rescaled mid-dwell, as gaze-engine.js does every frame
  const { d, log } = make({ adaptive: false }); t = 0;
  for (let i = 0; i < 20; i++) d.update(160, 170, t += 33);
  d.setDwellTime(2400); for (let i = 0; i < 3; i++) d.update(160, 170, t += 33);
  d.setDwellTime(1200); d.update(160, 170, t += 33);
  console.log(`R3 progress: ${log.p.slice(-8).join(' -> ')}`);
}
{ // R4: one frame 30 px outside the key's edge
  const { d, log } = make(); t = 0;
  for (let i = 0; i < 30; i++) d.update(160, 170, t += 33);
  const before = log.p.at(-1);
  d.update(260, 170, t += 33); d.update(160, 170, t += 33);
  console.log(`R4 progress ${before} -> ${log.p.at(-1)} after one frame outside the key`);
}
{ // R5: DriftDetector
  const c = { x: 100, y: 100 }, sz = { width: 100, height: 100 };
  const dd = new DriftDetector();
  for (let i = 0; i < 20; i++) dd.onDwellActivate(c, c, sz);
  let n = 1; while (!dd.onDwellActivate({ x: 170, y: 100 }, c, sz)) n++;
  const edge = new DriftDetector(); let flagged = false;
  for (let i = 0; i < 20; i++) flagged = edge.onDwellActivate({ x: 150, y: 100 }, c, sz);
  console.log(`R5 after 20 accurate dwells, first flag on corner-level miss #${n}; 20 dwells on a key edge -> flagged=${flagged}`);
}
```

Output (2026-09-23):
```
R1 progress 0.19, 2 s gap, one frame on the same key -> activations: 1
R2 10 s on one key -> 5 activations at 1254, 3102, 4950, 6798, 8646 ms
R3 progress: 0.3 -> 0.33 -> 0.36 -> 0.39 -> 0.21 -> 0.22 -> 0.23 -> 0.49
R4 progress 0.78 -> 0 after one frame outside the key
R5 after 20 accurate dwells, first flag on corner-level miss #18; 20 dwells on a key edge -> flagged=false
```

### A.2 Autocorrect and body-map overlap

```js
// node audit-ui.js   — run from the repository root; evaluates the real files in a sandbox.
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {}, document: {} });
vm.runInContext(fs.readFileSync('dictionary.js', 'utf8') + ';this.D = LumiDictionary;', ctx);
vm.runInContext(fs.readFileSync('body-map.js', 'utf8') + ';this.B = LumiBodyMap;', ctx);
// keyboard.js emits UPPERCASE letters and autocorrects the last word on SPACE
console.log(['CANT', 'DONT', 'HOME', 'LOVE', 'SICK', 'OK', 'TV', 'KIDS', 'JOHN', 'ANNA', 'WIFI', 'NEEDS', 'PAIN', 'NOT']
  .map(w => `${w}->${ctx.D.autocorrect(w)}`).join('  '));
// Body map: later PARTS are painted on top, so they win the hit-test where zones overlap
const inside = (p, x, y) => ((x - p.cx) / p.rx) ** 2 + ((y - p.cy) / p.ry) ** 2 <= 1;
for (const p of ctx.B.PARTS) {
  const top = ctx.B.PARTS.filter(q => inside(q, p.cx, p.cy)).at(-1).id;
  if (top !== p.id) console.log(`centre of ${p.id} -> hit-test returns ${top}`);
}
```

Output:
```
CANT->Want  DONT->Door  HOME->Some  LOVE->Move  SICK->Sit  OK->Or  TV->I  KIDS->Is  JOHN->Son  ANNA->An  WIFI->Wife  NEEDS->Need  PAIN->PAIN  NOT->NOT
centre of head -> hit-test returns eyes
centre of chest -> hit-test returns back
centre of stomach -> hit-test returns back
```

**SVG `click()` (H4):** on the Body Map tab, run `typeof document.querySelector('.body-zone').click` in the DevTools console. It returns `"undefined"`; in headless Chrome 153, calling it threw `TypeError: z.click is not a function`.

### A.3 Calibration report and head turns (synthetic data, real modules)

```js
// node audit-calibration.js   — run from the repository root. Real modules, SYNTHETIC data:
// shows how the estimator and its quality report behave; it does NOT measure the app on a person.
const path = require('path');
const RMath = require(path.resolve('gaze/ridge-regression.js'));
globalThis.RidgeRegressor = RMath.RidgeRegressor; globalThis.GazeRegressionMath = RMath;
const { GazeCalibration, buildLayout } = require(path.resolve('gaze/gaze-calibration.js'));

let seed = 99173;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss(s) { let u = 0; while (u === 0) u = rnd(); const v = rnd(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Generator (assumptions): gaze angle = head angle + eye-in-head angle; the screen spans ±15° x ±9°;
// the iris ratio moves K = 0.0028 per degree of eye rotation (±15° -> ±0.042, similar to the ~0.03 std
// in the stored calibrations); per-frame landmark jitter `jit`; per-target fixation error `fix` (deg).
const DEG_X = 15, DEG_Y = 9, K = 0.0028, W = 1440, H = 900;
function frame(sx, sy, fix, head, jit) {
  const gx = (sx - 0.5) * 2 * DEG_X, gy = (sy - 0.5) * 2 * DEG_Y;
  const ex = gx - head.yaw + fix.x, ey = gy - head.pitch + fix.y;
  return [0.5 + K * ex + gauss(jit), 0.5 + K * ey + gauss(jit), 0.5 + K * 1.03 * ex + gauss(jit), 0.5 + K * 0.98 * ey + gauss(jit),
          head.yaw + gauss(0.4), head.pitch + gauss(0.4), gauss(0.3), 0.28 + 0.004 * ey + gauss(0.008), 0.12 + gauss(0.0005), 0.10 + gauss(0.0005)];
}
function collect(points, n, headFn, fixSd, jit) {
  const rows = [];
  points.forEach((p, g) => { const fix = { x: gauss(fixSd), y: gauss(fixSd) }; const head = headFn(p);
    for (let i = 0; i < n; i++) rows.push({ f: frame(p.x, p.y, fix, head, jit), x: p.x, y: p.y, g }); });
  return rows;
}
function rmsePx(cal, rows) { let s = 0; for (const r of rows) { const p = cal.predict(r.f); s += ((p.x - r.x) * W) ** 2 + ((p.y - r.y) * H) ** 2; } return Math.sqrt(s / rows.length); }
function lotoPx(cal, layout, rep) {           // leave-one-target-out, same lambdas as the app chose
  let s = 0, n = 0;
  for (let h = 0; h < layout.length; h++) {
    const tr = [], te = [];
    cal.trainX.forEach((f, i) => { const r = { f, x: cal.trainYx[i], y: cal.trainYy[i] };
      ((Math.abs(r.x - layout[h].x) < 1e-9 && Math.abs(r.y - layout[h].y) < 1e-9) ? te : tr).push(r); });
    const mx = new RMath.RidgeRegressor({ degree: 2, lambda: rep.lambdaX }).fit(tr.map(r => r.f), tr.map(r => r.x));
    const my = new RMath.RidgeRegressor({ degree: 2, lambda: rep.lambdaY }).fit(tr.map(r => r.f), tr.map(r => r.y));
    for (const r of te) { const px = Math.max(0, Math.min(1, mx.predictRow(r.f))), py = Math.max(0, Math.min(1, my.predictRow(r.f)));
      s += ((px - r.x) * W) ** 2 + ((py - r.y) * H) ** 2; n++; }
  }
  return Math.sqrt(s / n);
}
const still = () => ({ yaw: gauss(0.3), pitch: gauss(0.3) });
const follows = (p) => ({ yaw: 0.6 * (p.x - 0.5) * 2 * DEG_X + gauss(1), pitch: 0.4 * (p.y - 0.5) * 2 * DEG_Y + gauss(1) });
const fresh = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) fresh.push({ x: 0.15 + i * 0.233, y: 0.15 + j * 0.233 });
const scenarios = [
  { name: 'A head still; fixation sd 0.5 deg; jitter .008', calHead: still, useHead: still, fix: 0.5, jit: 0.008 },
  { name: 'B head still; fixation sd 1.5 deg; jitter .004', calHead: still, useHead: still, fix: 1.5, jit: 0.004 },
  { name: 'C head follows targets in calib; eyes only in use', calHead: follows, useHead: still, fix: 0.5, jit: 0.008 },
  { name: 'D head follows targets in calib and in use', calHead: follows, useHead: follows, fix: 0.5, jit: 0.008 },
];
console.log('scenario                                            pts  app-reported  LOTO  fresh  lambdaX/Y  rating');
for (const sc of scenarios) for (const nPts of [9, 25]) {
  const layout = buildLayout(nPts), cal = new GazeCalibration(); let tgt = cal.begin(nPts), g = 0;
  const rows = collect(layout, 33, sc.calHead, sc.fix, sc.jit);          // 1100 ms at 30 fps per point
  while (tgt) { rows.filter(r => r.g === g).forEach(r => cal.addSample(r.f)); tgt = cal.commitPoint().next; g++; }
  const rep = cal.train({ width: W, height: H });
  const lo = lotoPx(cal, layout, rep), fr = rmsePx(cal, collect(fresh, 33, sc.useHead, sc.fix, sc.jit));
  console.log(`${sc.name.padEnd(51)} ${String(nPts).padStart(2)}  ${String(rep.accuracyPx).padStart(6)} px  ${lo.toFixed(0).padStart(5)} ${fr.toFixed(0).padStart(6)}  ${rep.lambdaX}/${rep.lambdaY}  ${rep.rating} (${rep.confidence}%)`);
  if (sc.name.startsWith('A')) {            // head turn after a head-still calibration, gaze kept on centre
    const out = [0, 2, 5, 10].map(yaw => `${yaw}deg:${rmsePx(cal, collect([{ x: 0.5, y: 0.5 }], 30, () => ({ yaw, pitch: 0 }), sc.fix, sc.jit)).toFixed(0)}px`);
    console.log(`   head-turn test (${nPts} pts, calib yaw std ${cal.modelX.scaler.std[4].toFixed(2)} deg): ${out.join('  ')}`);
  }
}
```

Output:
```
scenario                                            pts  app-reported  LOTO  fresh  lambdaX/Y  rating
A head still; fixation sd 0.5 deg; jitter .008       9     123 px    129    136  0.2/0.01  Excellent (95%)
   head-turn test (9 pts, calib yaw std 0.50 deg): 0deg:115px  2deg:205px  5deg:563px  10deg:745px
A head still; fixation sd 0.5 deg; jitter .008      25     122 px    123    120  0.01/0.2  Excellent (94%)
   head-turn test (25 pts, calib yaw std 0.49 deg): 0deg:117px  2deg:142px  5deg:701px  10deg:849px
B head still; fixation sd 1.5 deg; jitter .004       9     108 px    152    139  0.01/0.01  Excellent (96%)
B head still; fixation sd 1.5 deg; jitter .004      25     107 px    122    133  0.01/0.01  Excellent (95%)
C head follows targets in calib; eyes only in use    9      68 px     83    343  0.01/0.05  Excellent (98%)
C head follows targets in calib; eyes only in use   25      97 px    111    234  0.01/0.01  Excellent (95%)
D head follows targets in calib and in use           9      78 px    162    105  0.01/0.01  Excellent (98%)
D head follows targets in calib and in use          25      92 px    105     94  0.01/0.01  Excellent (96%)
```

### A.4 Server exposure (C1, H7, L2)

Run this on a **throwaway copy**, never the real folder. The copy also listens on all interfaces, so use a network you trust.

```bash
mkdir -p /tmp/lumi-probe && cp server.py /tmp/lumi-probe/ && cd /tmp/lumi-probe
echo 'DUMMY=1' > .env
python3 server.py 8765 &                                   # creates an empty lumiiq.db next to the copy
sleep 1
curl -s localhost:8765/lumiiq.db | head -c 15; echo       # → SQLite format 3
curl -s localhost:8765/.env                               # → DUMMY=1 (dotfiles are served)
curl -s -X POST -H 'Content-Type: text/plain' \
     -d '{"text":"<img src=x onerror=alert(1)>"}' localhost:8765/api/logs/typed
curl -si localhost:8765/api/logs | grep -i -e access-control -e onerror   # → ACAO: * and the stored payload
curl -s -X PUT -d '{"alarmVolume":0,"earThreshold":0.99,"dwellTimeMs":"abc"}' localhost:8765/api/settings
curl -s -X DELETE localhost:8765/api/logs                 # → {"cleared": true}
kill %1
```

### A.5 Duplicate alert rows (M7), read-only

```bash
sqlite3 -readonly eyecare.db "SELECT id, type, timestamp FROM alert_logs ORDER BY id LIMIT 6;"
```

---

## Appendix B — Method and side-effect control

- **Nothing in the project was changed.** Before writing this file, I confirmed that no file under `/Users/axel/EyeCare` had been modified during the audit.
- **Anything that could write ran on a copy:**
  - `validate.py` ran on a copy, because it writes a database.
  - The databases were read from copies.
  - `server.py` was exercised as a copy in a scratch folder, bound to 127.0.0.1.
  - Headless Chrome used throwaway profiles.
  - To measure element sizes, the real `index.html` was loaded read-only over `file://`.
- **Tools:** Node v24.18.0, JavaScriptCore (macOS), Python 3.14.2 and 3.11.15, SQLite 3.51.0, headless Chrome 153 (via Playwright/patchright).
- **Not verified:**
  - behaviour with a live webcam;
  - the app's real accuracy, precision and lag;
  - whether the selected TTS voices are local (H8);
  - the head-pose matrix layout (§5.6);
  - the size of blink-onset artefacts;
  - behaviour in browsers other than Chrome.
- **Not audited** beyond the secret scan: `backend/`, `archive/`.
