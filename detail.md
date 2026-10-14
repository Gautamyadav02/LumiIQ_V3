# LumiIQ — Complete Project Detail

*Updated 14 October 2026 from the code on branch `phase-b-eval`. First written 28 September 2026.
Every number below was read from the code or produced by the test suite on 14 October. Where
something has not been measured, this document says so.*

---

## Current state at a glance (14 October 2026)

| | |
|---|---|
| **Current code** | Branch `phase-c-gaze`: the original app + 18 audit-fix commits + 5 diagnosis commits + the evaluation tool + seven switchable accuracy changes (C1–C7, all on) |
| **On GitHub** | `main` and `fix/phase0-findings` only. `phase-a-diagnosis`, `phase-0-explain`, `phase-b-eval` and `phase-c-gaze` are **local only** |
| **Tests today** | `npm test` passes: 32 gaze unit tests, 1 smoke test, 285 Node tests (284 pass, 1 known "todo"), 39 server tests |
| **Works** | Keyboard, phrases, body map, speech, alarms, sleep mode, calibration, dwell and blink selection, caregiver dashboard, diagnostics, the evaluation wizard, local server |
| **Main problem** | **Gaze accuracy is poor in real use.** The author and the supervisor have both seen this. It has not been measured yet, so there is no number for it |
| **The evaluation tool** | **Built** (the dissertation's Section 3.6): wizard, recording, replay and report. **No real session has been recorded yet**, so `eval/BASELINE.md` is empty. Every number the tool has produced so far is synthetic |
| **Accuracy changes (Phase C)** | C1–C7 built and tested on synthetic data, each switchable (section 9.8). **Not yet measured on a person**: `eval/IMPROVEMENTS.md` is an empty template |
| **Waiting on** | Real sessions (see `docs/RECORDING.md`), and the Phase A on-screen checks (D1–D6), which have not been reported back |

**What changed since the 28 September version of this document:**
- **Phase A (30 Sep):**
  - a detection overlay, frame statistics and an eyes open/closed check (section 5.6);
  - *Reset settings to defaults*;
  - the misleading amber crosshair replaced by an "eye direction" inset.
- **Phase B (14 Oct):**
  - the **evaluation wizard**, session recording, offline replay and the report (section 5.7);
  - a serious bug found and fixed: **the camera stopped whenever its picture was scrolled out of
    view**, silently stopping gaze and every alarm (section 6);
  - the calibration's own quality estimate now uses leave-one-target-out (audit M1, section 10.3).
- **Phase C (14 Oct):** seven accuracy changes, each a switch, all on by default (section 9.8), and
  `npm run eval:ablation`, which compares each one with the baseline on held-out sessions.
- **Still open:** three problems found in Phase A (section 19, items 2–4).

---

## Contents

1. [What LumiIQ is](#1-what-lumiiq-is)
2. [Quick facts](#2-quick-facts)
3. [Project history: seven versions](#3-project-history-seven-versions)
4. [How to run it](#4-how-to-run-it)
5. [Using the app](#5-using-the-app)
6. [Safety alarms](#6-safety-alarms)
7. [Sleep mode](#7-sleep-mode)
8. [How it works: architecture](#8-how-it-works-architecture)
9. [How it works: the gaze pipeline](#9-how-it-works-the-gaze-pipeline)
10. [Calibration](#10-calibration)
11. [Selecting a target: dwell and blink](#11-selecting-a-target-dwell-and-blink)
12. [Server and REST API](#12-server-and-rest-api)
13. [Data storage](#13-data-storage)
14. [Settings reference](#14-settings-reference)
15. [Privacy and security](#15-privacy-and-security)
16. [Testing](#16-testing)
17. [Code map](#17-code-map)
18. [Audit findings and their status](#18-audit-findings-and-their-status)
19. [Known limitations and risks](#19-known-limitations-and-risks)
20. [Roadmap](#20-roadmap)
21. [Git and GitHub](#21-git-and-github)
22. [Design decisions and the reasons for them](#22-design-decisions-and-the-reasons-for-them)
23. [Other documents in this folder](#23-other-documents-in-this-folder)
24. [Glossary](#24-glossary)

---

## 1. What LumiIQ is

LumiIQ is a communication and safety aid for people who cannot speak or move but can still move
their eyes: for example people with advanced ALS, locked-in syndrome, or severe paralysis after a
stroke. It runs in a web browser on an ordinary laptop and uses the laptop's own webcam. No
eye-tracking hardware is needed.

The patient selects things on screen with their eyes, in one of two ways:
- **Dwell:** look at a target until a ring around it fills.
- **Blink:** look at a target, then close the eyes deliberately for about half a second.

With that they can:
- type a sentence on an on-screen keyboard and have it spoken aloud;
- pick a ready-made phrase ("I'm thirsty", "Call nurse");
- show where it hurts on a body diagram;
- call the nurse.

The app also watches for danger signs and sounds a siren on the laptop:
- eyes closed for too long;
- rapid blinking;
- the face leaving the camera;
- the camera being disconnected.

A caregiver dashboard shows the live camera, a timeline of everything the patient said, a safety-alert
log, calibration, a sleep-mode switch and all settings.

**Status:**
- **Research prototype, not a medical device.**
- **Gaze accuracy is poor in real use, and has not been measured yet.** The author and the
  supervisor have both observed it. The tool to measure it now exists (section 5.7); the
  measurements need recorded sessions.
- It is the artefact of an MSc dissertation.

---

## 2. Quick facts

| | |
|---|---|
| Name | LumiIQ (the on-screen header still says "EyeCare") |
| Type | Browser app + small local Python server |
| Front end | Plain JavaScript (no framework, no build step), HTML, CSS |
| Face tracking | Google MediaPipe Face Landmarker, version 0.10.14, stored in this folder (`lib/mediapipe/`, `models/face_landmarker.task`, 3.76 MB) |
| Gaze model | Ridge regression over degree-2 polynomial features, trained per user by calibration |
| Server | Python 3 standard library only (`server.py`); no `pip install` |
| Database | SQLite file `lumiiq.db`, created on first run |
| Runs on | Chrome on a laptop/desktop with a webcam; tested on macOS |
| Internet needed? | No. Every file the app needs is served locally |
| Languages | English (US/UK) and Hindi for speech; bilingual labels on the body map |
| Tests | 32 gaze unit tests, 1 smoke test, 232 Node tests (231 pass, 1 recorded "todo"), 37 server tests |
| Size | About 8,900 lines of app and evaluation code (JavaScript, HTML, CSS, Python) and 4,800 lines of tests, excluding the vendored MediaPipe |

---

## 3. Project history: seven versions

The project went through several attempts. The dates are the folder creation dates on the
development Mac. All seven are kept as **private** repositories on GitHub under `Gautamyadav02`.

| Created | Version | What it was | Outcome | GitHub repo |
|---|---|---|---|---|
| 23 May 2026 | eyetrack | Python desktop gaze tracker (customtkinter + pyautogui + MediaPipe) | First attempt; abandoned for a browser app | `LumiIQ_eyetrack` |
| 25 May 2026 | EGT | Python desktop tracker, second attempt (iris tracker, Kalman filter, keyboard window) | Superseded by the browser app | `LumiIQ_EGT` |
| 26 May 2026 | **OcuLink** | First browser version: keyboard, body map, alarms, MediaPipe from a CDN | Became the base of EyeCare | **`LumiIQ_V1`** |
| 8 Jun 2026 | **EyeCare v3 rebuild** | FastAPI backend + redesigned frontend ("v3 standalone" in the dissertation) | Failed: the new frontend never loaded the gaze engine, so it could not be operated by eye | **`LumiIQ_V2`** |
| 23 Jun 2026 | Eyra platform | Multi-tenant SaaS rewrite (FastAPI + PostgreSQL + React/TypeScript, 20 languages) | Never run; no working gaze pipeline | `LumiIQ_Eyra` |
| 25 Jul 2026 | DeepGaze | Experiment: a CNN (iTracker-style) trained on eye images | Experiment only; code uploaded, eye photos and trained model kept private | `LumiIQ_DeepGaze` |
| Jun–Sep 2026 | **LumiIQ** | The EyeCare browser app, developed in place and renamed LumiIQ in Aug–Sep | **The working app** (this document) | **`LumiIQ_V3`** |

**Naming, to be careful with in the viva:**
- The dissertation, `AUDIT.md` and `CHANGELOG.md` call the current app **"v1"** and the FastAPI
  rebuild **"v3"** (or "v3 standalone").
- On GitHub the repos are numbered by date: `LumiIQ_V1` = OcuLink, `LumiIQ_V2` = the FastAPI
  rebuild, `LumiIQ_V3` = the current app.
- Inside `LumiIQ_V3`, the git tag **`LumiIQ_V1`** marks the current app as it was before any
  fixes, meaning the first LumiIQ release.
- The June EyeCare app was edited in place until it became LumiIQ, so no separate copy of the
  June state survives.

---

## 4. How to run it

**Requirements:**
- Python 3 (any recent version; standard library only);
- Google Chrome;
- a webcam.

Node.js 18+ is needed only to run the tests.

```bash
cd /Users/axel/EyeCare
python3 server.py                 # http://localhost:8000, reachable from this computer only
python3 server.py 9000            # a different port
python3 server.py --db other.db   # a different database file
```

Then, in Chrome:

1. Open `http://localhost:8000`.
2. The **first time after an update**, press **Cmd+Shift+R** (hard reload) once, so the offline
   cache picks up the new files.
3. Go to the **⚙ Caregiver** tab → **Start Gaze Camera**, and allow the webcam.
4. Sit 0.5–1 m from the camera in even light → **Calibrate Gaze Engine** → pick 5, 9, 16 or 25
   points → follow the orange dot with your eyes, keeping your head still.
5. Review the result and press **Accept & Use This Calibration**. Gaze selection is switched off
   until a calibration has been accepted.
6. Go back to **Keyboard**, **Phrases** or **Body Map** and select by looking.

Stop the server with **Ctrl+C**. `start.sh` launches the old FastAPI rebuild, not this app.

**If you see `OSError: [Errno 48] Address already in use`:** another program is using the port.
On the development Mac, port 8000 is used by a different project (`veritas-lens`). Start LumiIQ
on a free port instead, for example `python3 server.py 8002`, and open `http://localhost:8002`.

---

## 5. Using the app

The top bar has four tabs. The first three are for the patient and can be selected by gaze. The
Caregiver tab cannot be opened by gaze, so the patient cannot land there by accident.

### 5.1 Keyboard (patient)

- **Layout:** QWERTY letters in three rows, plus **⌫** (delete), **SPACE**, **🗣 SPEAK** and
  **✕ CLEAR**.
- **Suggestion bar:** four word predictions. They come from a 139-word vocabulary aimed at
  patients and a small next-word table (13 context words).
  - A spelling correction is only ever *offered* in the bar. SPACE never changes a word
    (audit fix H6). Contractions typed without an apostrophe ("cant", "dont", "im", "ok") are
    real words in the vocabulary.
- **SPEAK** reads the sentence aloud and records it in the caregiver's timeline.
- **🔔 NURSE CALL (नर्स बुलाएं)** sounds the alarm at once (section 6).

### 5.2 Phrases (patient)

There are 16 ready-made phrases in four groups:

| Urgent | Comfort | Medical | Social |
|---|---|---|---|
| I need help | I'm thirsty | I need medicine | Call my family |
| Call nurse | I'm cold | I feel dizzy | Thank you |
| I can't breathe | Turn me over | My chest hurts | Yes |
| I'm in pain | Adjust pillow | Suction tube | No |

- Every phrase is spoken aloud and logged.
- **Urgent** phrases also sound the alarm (`URGENT_PHRASE`), like Nurse Call, so help does not
  depend on someone happening to hear the speech.

### 5.3 Body Map (patient)

- **Body parts:** a front-view body outline with nine non-overlapping zones (Head, Eyes, Throat,
  Chest, Stomach, Left Arm, Right Arm, Left Leg, Right Leg), plus a separate **Back** button,
  since the back cannot be drawn on a front view.
- **Left and right:** the diagram is a mirror, so "Left Arm" is on the viewer's left.
- **Symptoms:** selecting a part opens six options: Pain, Itching, Numbness, Spasm, Cold, Hot.
- **Result:** the choice is spoken in English and Hindi (e.g. "Head pain. सिर में दर्द है।")
  and logged as a symptom report.

### 5.4 Caregiver dashboard (caregiver only, mouse/touch)

- **Live Tracking Feed:**
  - the webcam image, shown mirrored;
  - a small **eye direction** inset in the corner: the raw, uncalibrated direction of the eyes;
  - **Start/Stop Gaze Camera**;
  - **Show detection overlay** (section 5.6).
  - Stopping the camera shows a persistent "monitoring is OFF" notice.
- **Sleep Mode:** 🌙 on/off button (section 7).
- **Gaze Calibration:** start calibration; shows the engine's status line.
- **Diagnostics:** frame statistics and the eyes open/closed check (section 5.6).
- **Patient Timeline:** everything the patient said or reported, newest first. Log text is
  always shown as plain text, never interpreted as HTML (fix H7).
- **Safety Alerts:** the alarm log (section 6).
- **Platform Settings:** every tunable value (section 14), and **Reset settings to defaults**.

### 5.5 Status and notices

- A **status pill** in the header shows the tracking state, for example:
  - "Not calibrated — gaze clicks off";
  - eyes closed;
  - low confidence;
  - calibrating.
- An alarm message stays up until it is dismissed.
- A **notice banner** under the header carries messages the caregiver must not miss:
  - camera stopped;
  - monitoring was paused;
  - speech failed;
  - a sleep-mode report.
- A **🌙 badge** shows while sleep mode is on.

### 5.6 Diagnostics (caregiver only, added in Phase A)

These tools exist to answer one question: is the problem **detection** (MediaPipe puts the eye
points in the wrong place) or **mapping** (the points are right, but the screen position is
wrong)? Nothing they show is saved or sent.

- **Detection overlay** (tick *Show detection overlay* under the live feed):
  - **On the video:** a cyan crosshair on each iris centre, amber dots on the eye corners and
    eyelid edges, and each eye's EAR (green = counted open, red = counted closed).
  - **Under the video:** EAR per eye, the threshold, confidence, head yaw/pitch/roll, and
    whether this frame produced a gaze point, and if not, why.
  - **Eye labels:** R and L mean the **patient's** right and left eye.
  - **Alignment:** checked in Chrome with a fake camera. The markers land within about 1 px of
    the video content they describe (**synthetic** test video).
- **Frame statistics** (Start / Stop / Reset):
  - % of frames with a face, and with a gaze point;
  - the reasons frames gave no gaze point;
  - the spread of confidence and of EAR;
  - how many "open" samples the default EAR threshold would have called closed.
- **Eyes open / closed check** (8 seconds):
  - the patient looks at a dot at the top, then at the bottom;
  - at a chime they close their eyes for 2 s, and at the next chime they open them;
  - the result says how the current EAR threshold classifies this person's open and closed
    eyes, and the range in which a threshold would separate them.
- **The old amber crosshair is gone.** It was misleading:
  - it never sat on an eye;
  - it moved the opposite way to the eyes;
  - its numbers were drawn backwards.

What to look at, step by step, is in `docs/diagnosis/phase-a.md` (checks D1–D6 and M1–M3).

### 5.7 Evaluation session (caregiver only, added in Phase B)

This is the evaluation the dissertation's Section 3.6 describes. **Caregiver → Diagnostics →
Start an evaluation session** runs a guided session of about 10 minutes and saves it as one file.

| Stage | What it does |
|---|---|
| 1 Consent | Says what is and is not recorded. The box is never pre-ticked; nothing is recorded before it |
| 2 Setup | Viewing distance and screen width (for degrees of visual angle), and a lighting label |
| 3 Settings reset | Shows the current settings, then applies the defaults |
| 4 Calibration | 9 points, head still, with the app's own timing |
| 5 Accuracy check | 12 targets the model never saw: 4 corners, 2 in the header band, 2 on the right edge (one on Nurse Call), 4 interior |
| 6 Head movement | Turn left/right, tilt up/down, lean closer/back. A live readout guides each one; 4 targets are measured after each |
| 7 Selection test | 10 prompted keys by dwell, then 10 by blink, on the real keyboard. Selections are intercepted: nothing is typed or spoken |
| 8 Rest | 2 minutes with the keyboard visible and no intent to select: any selection is a false activation |
| 9 Lag and jitter | A 5-second fixation and a jumping target, at smoothing 0.35 and 0.06 |
| 10 Calibration again | 16 points, then the same 12 targets |

- **What is recorded:** numbers only. Per frame: 16 landmark positions, the head matrix, the
  features, the predictions and timestamps. Per session: the camera picture's size in pixels,
  and when each calibration point was committed. Never video or images.
- **Where:** `eval/sessions/<id>.json`, on this computer, excluded from git. A session is 4–8 MB.
- **Stopping** at any point saves nothing. Safety alarms stay on throughout.
- **`node eval/replay.js`** re-runs a recorded session through the app's own gaze code and reports
  how closely it reproduces the live gaze. Options change the model and the smoothing, so
  variants are compared on identical data.
- **`npm run eval:report`** writes `eval/BASELINE.md`:
  - the dissertation's Tables 4.6 and 4.7 as mean ± SD across sessions;
  - the 95th-percentile error and the smallest target it allows;
  - the session ids behind every row.
  - Every row is labelled "replayed real" or "live real", and a figure with no data is "—".
- **How to record** is in `docs/RECORDING.md`: at least 3 sessions per lighting condition, in
  2 lighting conditions, over 2 days.

---

## 6. Safety alarms

All alarms behave the same way:
- a full-screen **EMERGENCY DISTRESS** card;
- a repeating siren: 0.4 s sawtooth beeps at 660/880 Hz, every 0.5 s, at the *Alarm Volume* setting;
- one entry in Safety Alerts.

The siren continues until someone presses **CAREGIVER CONFIRMED — Dismiss** with the mouse. That
button is not a gaze target.

**Alarms sound on this device only. Nothing is sent to a phone, a pager or the internet.** The
alarm card says so. An earlier version falsely claimed "API webhook sent" (fix H2).

| Code | Trigger | Paused by sleep mode? |
|---|---|---|
| `NURSE_CALL_BUTTON` | Patient selects 🔔 Nurse Call | No |
| `URGENT_PHRASE` | Patient selects an Urgent phrase | No |
| `PROLONGED_CLOSURE` | Eyes closed for 3 s or more. One alarm per closure: the eyes must open and close again for a new one | **Yes** (this is the only paused alarm) |
| `RAPID_BLINKS` | 6 blinks within 3 s; at most once every 15 s | No |
| `FACE_NOT_DETECTED` | No face in the camera for *Face-lost alarm* seconds (default 10) while tracking | No |
| `CAMERA_LOST` | The camera stops (unplugged, blocked, taken by another app) | No |
| `CAMERA_STALLED` | Camera frames stop arriving for *Face-lost alarm* seconds while tracking (added in Phase B) | No |

Some events are **logged but do not sound the siren:**
- `MONITORING_PAUSED` / `MONITORING_RESUMED`: the browser stops delivering camera frames when the
  app is hidden (tab switched, window minimised). This is logged, and on return the notice says
  for how long monitoring was paused.
- `SLEEP_MODE_ON` / `SLEEP_MODE_OFF` and `SLEEP_ACTIVITY` (section 7).

Each event is logged exactly once. The original code logged every alarm two or three times
(fix M7).

**The camera watchdog (Phase B).** Every safety check runs when a camera frame arrives, so if
frames stop, nothing would ever alarm. A watchdog checks once a second:
- after 2 s without a frame it tries to resume the video and shows "Camera frames have stopped";
- if they stay away for the face-lost time it raises `CAMERA_STALLED`.

It was added after finding that Chrome paused the camera whenever its picture was scrolled out
of view on the dashboard. That cause is fixed too: playback is now started explicitly, without
`autoplay`.

---

## 7. Sleep mode

**Why it exists:** when the patient sleeps, closed eyes are normal, and the eyes-closed alarm would
wake everyone. Sleep mode was designed with the project owner to solve that without switching
monitoring off.

**How it works:**
- The caregiver presses **🌙 Turn Sleep Mode On** on the dashboard.
- **Only** the eyes-closed alarm (`PROLONGED_CLOSURE`) is paused. The no-face, camera-lost and
  rapid-blinking alarms stay on, and so do Nurse Call and the urgent phrases.
- **Activity report:** after the patient has been asleep (eyes closed for 30 s), the caregiver is
  told of any activity:
  - the eyes open and stay open for *Sleep: eyes open for* seconds (default 5, range 2–60);
  - or the patient makes any selection.
  - The report is a soft chime, a banner and a `SLEEP_ACTIVITY` log entry.
  - It is sent **once per waking**, and re-arms when the patient falls asleep again.
  - Turning sleep mode on while the patient is still awake does not trigger a report.
- **Visible and logged:** a 🌙 badge shows in the header. Switching it on or off is logged, and
  it survives a page reload (stored as `sleepModeUntil`, an end time).

**Safety net:** sleep mode switches itself off after **12 hours**, in case it is forgotten, and
says so. A stored end time more than 12 hours ahead is not trusted.

**Limits:**
- Reports appear on this laptop only; nothing reaches a phone.
- In a dark room the camera cannot see the face, so the no-face alarm will sound. Some light is
  needed.

---

## 8. How it works: architecture

```
                 ┌────────────────────────── Browser (Chrome) ───────────────────────────┐
 Webcam ──► MediaPipe Face Landmarker ──► LumiGaze (gaze-engine.js) ──► EyeApp (app.js)  │
                                         │ features → model → smoothing │    │ cursor, ring │
                                         │ → dwell / blink → click      │    │ alarms, UI   │
                                         └──────────────┬───────────────┘    └──────┬───────┘
                          Keyboard / Phrases / Body Map │    LumiVoice (speech)     │
                                                        ▼                            ▼
                                          LumiStore (database.js): in-memory cache
                                          + localStorage queue of unsent writes
                 └──────────────────────────────────────┬─────────────────────────────────────┘
                                                        │ HTTP JSON (localhost only)
                                          server.py ────┴──► SQLite lumiiq.db
```

**Principles:**
- **The whole gaze loop runs in the browser.** About 30 frames per second, with no network in the
  loop, so a slow or absent server never delays the cursor.
- **The server only stores things:** settings, calibration and logs, and it serves the app's files.
- **Writes never block and are never lost silently.** `LumiStore` keeps an in-memory copy of
  everything and sends writes to the server in the background. Unsent writes wait in a
  `localStorage` queue (section 13).
- **Modules are plain script globals**, loaded in a fixed order by `index.html`:
  1. `database.js` (`LumiStore`)
  2. `dictionary.js` (`LumiDictionary`)
  3. `voice.js` (`LumiVoice`)
  4. the `gaze/` modules
  5. `gaze-engine.js` (`LumiGaze`)
  6. `keyboard.js` (`LumiKeyboard`), `body-map.js` (`LumiBodyMap`) and `phrases.js` (`LumiPhrases`)
  7. `diagnostics.js` (`LumiDiagnostics`)
  8. `app.js` (`EyeApp`, which wires everything together)

  There is no build step.
- **Offline:** a service worker (`sw.js`) caches the app files, including MediaPipe's
  WebAssembly, so the app still opens without the server once loaded.
  - It is **network-first**: it always tries the server, and uses the cache only when the server
    can't be reached. This means updates are never hidden behind an old copy (fix M12).
  - API requests are never cached.

---

## 9. How it works: the gaze pipeline

Every camera frame goes through these steps (file: `gaze-engine.js` unless stated). Feature
extraction itself (sections 9.2 and 9.3) lives in `gaze/gaze-features.js`, so that the offline
replay runs exactly the same code as the live app.

### 9.1 Camera and face landmarks

- **Camera request:** 1280×720 at 30 fps, front-facing.
- **MediaPipe settings:**
  - video mode, one face;
  - it returns 478 face points (including the iris centres, points 468 and 473) and a 4×4 head
    transformation matrix.
- **GPU or CPU:** it runs on the GPU if available, otherwise on the CPU (fix L5).
- **Camera errors** are named clearly: no camera, camera in use, or permission denied.

### 9.2 Features (10 numbers per frame)

`_extractFeatures` builds the vector `[lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]`:

| Feature | Meaning |
|---|---|
| `lx, ly` / `rx, ry` | Where each iris sits inside its eye opening, from 0 to 1 horizontally and vertically |
| `yaw, pitch, roll` | Head rotation in degrees, from MediaPipe's transformation matrix |
| `ear` | Eye aspect ratio (eye height ÷ eye width), averaged over both eyes |
| `faceScale` | Distance between the outer eye corners (grows as the head comes closer) |
| `ipd` | Distance between the two iris centres |

**Eye aspect ratio (EAR)** decides if an eye is open: open when EAR > *EAR threshold*
(default 0.18).
- The engine's "left" eye: points 159–145 over 33–133.
- The engine's "right" eye: points 386–374 over 362–263.
- **Naming problem:** points 33/133/159/145 are MediaPipe's *right-eye* landmarks, which is the
  patient's right eye. So the engine's "left" is probably the patient's right eye unless
  *Swap Left & Right* is on (section 19, item 4).

**Single-eye use:**
- If only one eye is usable (by the *Active Eye* setting, or because one is closed), its values
  stand in for the other eye, so single-eye patients can still use the app.
- *Swap Left & Right* corrects cameras that mirror the image.

### 9.3 Confidence

`_computeConfidence` starts at 1.0 and lowers it when:
- the EAR is implausible (< 0.12 or > 0.45): ×0.5;
- the iris sits near the edge of the eye: ×0.6;
- the head is turned more than 25° (yaw) or tilted more than 20° (pitch): up to ×0.3.

**Effect:**
- Below 0.2 the frame produces no gaze point.
- A running average of confidence slows the dwell when tracking is poor: ×2.0 below 0.4, and
  ×1.3 below 0.7.

### 9.4 From features to a screen point

- **After calibration:** the trained model predicts a screen position (section 10.3).
- **Before calibration:** a rough fixed mapping (mirrored, gain 2.2) moves the cursor so the
  caregiver can see tracking works. **It never clicks:** gaze selection stays off until a
  calibration is accepted (fix M5).

### 9.5 Smoothing

Raw predictions jitter, so `gaze/gaze-stabilizer.js` smooths them with a **One-Euro filter**
(Casiez et al., 2012):
- when the eye is still, it smooths strongly;
- when the eye moves fast, it lets the movement through with little lag.

A **2.5-pixel deadband** holds the cursor still against tiny movements. The *Smoothing* setting
`f` (0.05–0.45) maps onto the filter:

- `minCutoff = 3.5 − 4f` → 3.3 Hz at f = 0.05 (least smoothing), 1.7 Hz at f = 0.45 (most)
- `beta = 0.04 − 0.05f`

The lag and jitter these settings produce **have not been measured yet** (Phase B).

### 9.6 Hit-testing

- Only elements marked `.gazeable` can be selected by gaze (fix C2). Plain buttons are for the
  caregiver's mouse: the alarm's Dismiss, Stop Camera, settings.
- Hit-testing runs at most 20 times a second, to keep the page smooth.

### 9.7 Per-frame record (added in Phase A)

After each frame the engine leaves a record (`LumiGaze.lastFrameInfo`, and the `onFrameInfo`
callback) holding:
- each eye's iris, corner and eyelid points, its EAR, and whether it counts as open and is used;
- head pose, confidence and the raw iris-in-eye ratio;
- whether the frame produced a gaze point, and the reason: `ok`, `uncalibrated`,
  `calibrating`, `eyes_closed`, `low_confidence` or `no_face`.

Nothing in the pipeline reads this record, so it cannot change gaze behaviour. The diagnostics
use it, and the Phase B session recorder will too.

---

### 9.8 Phase C changes C1–C7 (branch `phase-c-gaze`)

Each change is a switch (`GazeFeatures.IMPROVEMENTS`). All are on by default on this branch;
`LumiGaze.setImprovements('none')` gives exactly the Phase B app. Every evaluation session
records which were on. Details and the reasons: `CHANGELOG.md` (Phase C) and
`docs/adr/0003-phase-c-ablation.md`.

| | Change | Where |
|---|---|---|
| C1 | Eye features in the head's own frame, head angle added back (0.4 × sin) | `gaze/gaze-features.js` |
| C2 | Gaze needs an eye opening above 0.16; confidence ramps up above it | `gaze/gaze-features.js` |
| C3 | Stricter outlier filter for calibration samples | `gaze/gaze-calibration.js` |
| C4 | Ignore calibration samples from the first 300 ms after a target appears | `gaze/gaze-calibration.js` |
| C5 | Degree 1 or 2, whichever has the lower leave-one-target-out error | `gaze/gaze-calibration.js` |
| C6 | Low-confidence frames smoothed more | `gaze/gaze-stabilizer.js` |
| C7 | Drift detector that looks for a consistent direction | `gaze/drift-detector.js`, `app.js` |

**How they are judged:**
- `npm run eval:ablation` replays every recorded session with:
  - the baseline;
  - each change alone;
  - all seven together.
- **Held-out set:** the sessions of the last recording day. **Development set:** all earlier days.
- **Criteria** (fixed before any recording): 15 % better accuracy, or a lower p95, or fewer
  wrong selections, without more false activations or a longer time per selection.
- **No result exists yet.**

## 10. Calibration

Calibration teaches the model how this person's eyes map to this screen. It is needed per person
and whenever the camera, seat or lighting changes a lot.

### 10.1 Procedure (`app.js`, `gaze/gaze-calibration.js`)

1. **Choose the number of points:**

   | Points | Time |
   |---|---|
   | 5 | about 8 s |
   | 9 (default) | about 14 s |
   | 16 | about 26 s |
   | 25 | about 40 s |

   Targets form an even grid, 8% in from the screen edges.
2. **Each target:**
   - the dot appears and the eye is given **500 ms to land**;
   - samples taken during that time are thrown away;
   - then samples are collected for **1,100 ms**.
3. **Too few samples:** if fewer than 12 clean frames were collected (a blink or lost face), that
   point is repeated.
4. **Outlier removal:** for each target, a frame is dropped if it is a gross outlier (more than
   4 MADs from the median) in more than 30% of the features. At most 24 frames per target are kept.
   A frame that is off in exactly 3 of the 10 features is therefore kept (section 19, item 3).
5. **Training:** after the last point the model is trained. "Computing calibration…" is shown
   first, because training briefly freezes the page.
6. **Review and accept:** a results screen shows Quality, Confidence, Est. Accuracy and Clean
   Samples.
   - The new calibration is used and saved **only when the caregiver presses Accept**.
   - Recalibrate or Exit keeps the previous calibration working (fix M6).

Blink and eyes-closed detection keep running during calibration (fix L7).

### 10.2 The model

`gaze/ridge-regression.js` fits **two ridge-regression models**, one for screen X and one for
screen Y:
- **Expansion:** the 10 features are expanded to degree-2 polynomial terms: 10 linear, 10 squares
  and 45 pairwise products, i.e. 65 terms, plus an intercept.
- **Scaling:** each term is standardised (z-score).
- **Solving:** the least-squares problem with a ridge penalty λ is solved by **Householder QR** on
  the stacked system `[Z; √(λn)·I]`. This avoids forming `ZᵀZ`, which is numerically fragile.
- **Choosing λ:** from {0.01, 0.05, 0.2, 1, 5, 20} by **5-fold cross-validation**, separately
  for X and Y.

The saved calibration is about 9 KB of JSON: weights, means, standard deviations, λ and the
quality report.

### 10.3 The quality report, and what it can and cannot tell you

The results screen shows:
- **Rating:** from the cross-validated R²: Excellent ≥ 0.9, Good ≥ 0.8, Fair ≥ 0.65, otherwise Poor;
- **Confidence:** R² as a percentage;
- **Est. Accuracy:** the cross-validated RMS error in pixels.

**How it is estimated (changed in Phase B, audit M1):**
- **Before:** interleaved folds. Frames of the same target sat in both the training and the test
  folds, so the estimate was optimistic.
- **Now:** leave-one-target-out. Each fold trains on every target but one and tests on the one
  left out. Lambda is chosen the same way, so the trained model can differ from before.

**It is still not a measurement of accuracy:**
- On synthetic calibrations it comes out *above* the true error on unseen targets, because a
  held-out corner must be extrapolated. It errs on the safe side.
- The rating is based on R², which stays high even when the pixel error is large, so "Excellent"
  still says little.
- **The measurement is the held-out targets** in the evaluation session (section 5.7). The
  report prints the old estimate, the new estimate and the measured error side by side.

**Cost:** more models are trained, so "Computing the calibration…" takes longer (Node,
development Mac, synthetic samples):

| Points | Before | After |
|---|---|---|
| 9 | 83 ms | 189 ms |
| 16 | 144 ms | 612 ms |
| 25 | 227 ms | 1,572 ms |

---

## 11. Selecting a target: dwell and blink

The caregiver chooses the method with *Select with*:
- **Dwell or blink** (default);
- **Dwell only**;
- **Blink only**.

### 11.1 Dwell (`gaze/dwell-controller.js`)

A state machine: `IDLE → FOCUSING → DWELLING → activate → cooldown → IDLE`.

| Rule | Value | Why |
|---|---|---|
| Focus | Gaze must stay within 45 px for 150 ms before the ring starts | Ignores a gaze that just passes over a key |
| Dwell time | *Dwell Time* setting (default 1,200 ms), slowed when confidence is low, ×0.85–1.15 by steadiness | The time the ring takes to fill |
| Leaving | Moving off the target cancels the ring | — |
| Gap | No gaze sample for more than 300 ms (eyes closed, face lost) cancels the dwell | Before the fix, the dwell completed on the first frame back (fix H1) |
| Step cap | Progress advances at most 100 ms per frame | A stalled frame cannot jump the ring |
| Monotonic | Changing the dwell time mid-dwell changes the speed, never the level shown | Fix L1 |
| Cooldown | Nothing fires for 600 ms after a selection | — |
| Re-arm | The same target, or the same screen area if the page redrew it, cannot fire again until the gaze leaves it | A steady look once typed a key every ~1.85 s (fix M3) |
| Repeat | *Keep looking to repeat a key*: off by default. Off: look away and back, or blink, to repeat | — |

In *Blink only* mode the ring still fills, to show the target is armed, but only a blink selects.

### 11.2 Blink to select

1. The gaze must **rest on a target for 300 ms**. The target the gaze had rested on at most
   300 ms before the eyelids closed is remembered. The closing lid disturbs the gaze estimate,
   so the target at the moment of closing could be the wrong one.
2. The patient **closes both eyes deliberately** for at least *Blink-select* ms (default 500,
   range 300–1,200) and **up to 1.5 s**.
3. When the eyes open, that target is selected.

What does **not** select:
- normal blinks (roughly 0.1–0.4 s);
- closures longer than 1.5 s (and at 3 s the eyes-closed alarm fires);
- any blink before a calibration is accepted or during calibration.

Deliberate blinks are not counted towards the rapid-blinking alarm. Blinking again selects the
same key again, which is the easy way to type a double letter.

**Known risk, to be measured in Phase B:** a slow involuntary blink while resting the eyes on a
key can select it. Phase B counts false selections with blink-select on and off.

---

## 12. Server and REST API

`server.py` is about 600 lines of Python standard library (`ThreadingHTTPServer` + `sqlite3`).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{status, time}` |
| GET | `/api/settings` | — | all settings (invalid stored values fall back to defaults) |
| PUT | `/api/settings` | partial settings | validated, merged, saved |
| GET | `/api/calibration` | — | saved calibration or `null` |
| PUT | `/api/calibration` | calibration | validated, saved |
| GET | `/api/logs` | — | `{typed, symptom, alert}` |
| POST | `/api/logs/typed` | `{text, timestamp?}` | 201 |
| POST | `/api/logs/symptom` | `{bodyPart, symptom, timestamp?}` | 201 |
| POST | `/api/logs/alert` | `{type, details, timestamp?}` | 201 |
| DELETE | `/api/logs` | — | clears all logs |
| POST | `/api/eval/session` | one evaluation session | 201; written to `eval/sessions/<id>.json` |

**Validation:**
- **Settings:** every setting has a type and range (section 14). Unknown keys are ignored.
  Out-of-range or wrongly typed values are refused with HTTP 400.
- **Calibration:** must be version 3 with numeric weights, means and standard deviations.
- **Text limits:** typed text ≤ 1,000 characters; body part and symptom ≤ 100; alert details ≤ 500.
- **Alert type:** must be an upper-case code such as `NURSE_CALL_BUTTON`.
- **`timestamp`:** optional; the time of the event, used for writes queued while offline. It must
  be ISO 8601 with a timezone and not in the future.
- **Body size:** at most 256 KB per request; larger bodies are refused with 413.
- **Evaluation sessions** have their own endpoint and their own limit (64 MB). A session must
  have the right format, a safe id, consent given, numeric frames, and no long or image-like
  text. An existing session is never overwritten, and sessions are never served back.

**Security model:**
1. The server listens on **127.0.0.1**, so other computers cannot connect.
2. It accepts only requests addressed to `localhost`/`127.0.0.1`. This blocks "DNS rebinding",
   where a web page points its own domain at your machine.
3. It sends **no CORS headers** and requires `Content-Type: application/json` for writes. Other
   websites open in the same browser therefore can neither read the API nor write to it.
4. It serves **only the app's own files**, from an explicit allow-list. The databases, source
   code, dotfiles and folder listings return 404.
5. **Every stored value is validated.**

Before the fix (C1), the server listened on every network interface, served the whole folder
including the databases, and allowed any website to call the API.

The server **has no login**, which is acceptable only because it is reachable from this computer
alone. Putting it online (section 20) will need authentication and HTTPS first.

---

## 13. Data storage

### 13.1 SQLite (`lumiiq.db`, WAL mode)

| Table | Contents | Kept |
|---|---|---|
| `kv` | `settings` and `calibration` as JSON | — |
| `typed_logs` | spoken sentences and phrases | last 200 |
| `symptom_logs` | body part + symptom | last 200 |
| `alert_logs` | alarm and event log (codes in section 6) | last 100 |

### 13.2 In the browser (`localStorage`)

- `lumiiq_settings`, `lumiiq_calibration`: copies, so the app starts even if the server is down.
- `lumiiq_pending_writes`: the **offline queue** (fix M8).
  - Every message, symptom and alert is queued until the server confirms it, keeping its original
    time.
  - Retried at start-up, when the browser comes back online, and every 30 s.
  - Server errors (5xx) are kept for retry; invalid entries (4xx) are dropped.
  - At most 500 entries.
  - Queued entries appear in the timeline straight away.
- `lumiiq_diag_overlay`: only whether the detection overlay is switched on.

### 13.3 Real personal data: never put on GitHub

| File | What it holds |
|---|---|
| `eval/sessions/*.json` | Evaluation sessions: face-landmark positions over time, and the calibration |
| `lumiiq.db` | Real usage, Aug–Sep 2026: typed messages, symptoms, alerts, a face-derived calibration |
| `eyecare.db` | Real usage, Jun–Jul 2026, from the earlier EyeCare version |
| `~/DeepGaze-Experiment/dataset`, `models` | 76 photos of a real person's eyes, and a model trained on them |

All of them are excluded by `.gitignore`. A scan of the working tree and the full git history of
every repo found no databases, no secrets and no `.env` files.

**Under UK GDPR, health data combined with facial data is special-category data.** Any future
study with patients needs consent, a data protection assessment and ethics approval.

---

## 14. Settings reference

The caregiver sets these in **Platform Settings**. They are saved on the server and in the
browser. "UI range" is what the slider offers; the server accepts the wider "Server range".

| Setting (key) | UI control | UI range | Server range | Default | What it does |
|---|---|---|---|---|---|
| Dwell Time (`dwellTimeMs`) | slider, ms | 600–2,500 | 300–5,000 | 1,200 | Time to fill the ring |
| Select with (`selectionMode`) | list | Dwell or blink / Dwell only / Blink only | `both`/`dwell`/`blink` | Dwell or blink | Selection method |
| Blink-select (`blinkSelectMs`) | slider, ms | 300–1,200 | 300–1,200 | 500 | Minimum deliberate closure |
| Keep looking to repeat (`dwellRepeat`) | list | Off / On | true/false | Off | Repeat a key without looking away |
| Smoothing (`smoothingFactor`) | slider | 0.05–0.45 | 0.05–0.45 | 0.35 | Cursor steadiness vs lag (section 9.5) |
| Active Eye (`activeEye`) | list | Both / Left / Right | same | Both | Which eye(s) to track |
| Swap eyes (`swapEyes`) | list | Standard / Swap | true/false | Standard | For mirrored cameras |
| EAR threshold (`earThreshold`) | slider | 0.10–0.30 | 0.05–0.40 | 0.18 | Below this an eye counts as closed |
| Alarm Volume (`alarmVolume`) | slider | 0–1 | 0–1 | 0.7 | Siren loudness |
| Face-lost alarm (`faceLostAlarmSec`) | slider, s | 5–60 | 5–120 | 10 | No face this long → alarm |
| Sleep: eyes open for (`sleepWakeSec`) | slider, s | 2–60 | 2–60 | 5 | Wake-up report delay |
| Voice Rate / Pitch (`voiceRate`, `voicePitch`) | sliders | 0.5–2.0 | 0.5–2.0 | 0.95 / 1.0 | Speech speed and pitch |
| Voice Volume (`voiceVolume`) | slider | 0–1 | 0–1 | 1.0 | Speech loudness |
| Voice Language (`voiceLanguage`) | list | English (US) / English (UK) / Hindi | same | English (US) | Speech voice. Hindi text (Devanagari) is spoken in Hindi automatically |
| (`sleepModeUntil`) | Sleep Mode button | — | 0 to 10¹³ (epoch ms) | 0 (off) | When sleep mode ends |

**Reset settings to defaults** (a button under the settings) asks for confirmation, then puts
every setting back to the Default column. The calibration, the logs and sleep mode are kept.

**Settings currently saved on the development Mac** (read on 14 Oct 2026; the database was last
changed on 30 Sep 2026):

| Setting | Saved value | Note |
|---|---|---|
| Dwell Time | 600 ms | The shortest the UI allows |
| Smoothing | 0.45 | The most the UI allows (on 28 Sep it was 0.06, almost the least) |
| EAR threshold | 0.10 | The lowest the UI allows. Half-closed eyes count as open (section 19, item 2) |
| Select with | Dwell only | Blink selection is off |
| Blink-select | 300 ms | Not used while "Dwell only" is set |
| Alarm Volume | 0.7 | The default |
| Calibration | 25 points, 599 samples | The app rates it "Excellent" (96%, ~105 px). This is the app's own estimate from a live calibration; it is optimistic (section 10.3) and is not a measured accuracy |

---

## 15. Privacy and security

- **Nothing leaves the laptop.** A test (`tests/no-external-requests.test.js`) checks that the
  app makes no request to another server:
  - MediaPipe and its model are served from this folder;
  - fonts are no longer fetched from Google (fix L9);
  - the voice prefers on-device voices.
- **Speech:** online voices ("Google…", "…Natural") fail without internet and send the patient's
  words to a cloud service, so on-device voices are chosen first (fix H8).
  - Which voices are on-device depends on the operating system and browser. Check this on the
    target machine.
  - If speech fails, a visible warning appears.
- **The server is local-only** (section 12). It never logs alert details, which may contain health
  information.
- **Diagnostics stay on screen.** The detection overlay, frame statistics and eyes open/closed
  check are kept in memory only. They are never stored, logged or sent (ADR 0001).
- **Secrets:** the app has none. The Claude API and Twilio features described in older documents
  are out of scope and not implemented.
- `.claude/settings.local.json` (holds a development password) and the `archive/` folder are
  excluded from git.

---

## 16. Testing

Run everything with one command. Nothing needs installing beyond Node and Python.

```bash
npm test
```

| Suite | What | Result (14 Oct 2026) |
|---|---|---|
| `gaze/test_gaze.js` | Maths of the gaze modules: polynomial features, linear solver, ridge regression, cross-validation, One-Euro filter, stabiliser deadband, dwell, calibration layouts and a synthetic end-to-end calibration | 32 passed |
| `gaze/_smoke.js` | End-to-end smoke test of the gaze modules | OK |
| `tests/*.test.js` + `gaze/test_drift.js`, `gaze/test_confidence.js` (Node's built-in test runner, 28 files) | App behaviour: gaze targets, dwell, blink select, sleep mode, alarms, camera watchdog, calibration flow and cross-validation, offline queue, settings reset, keyboard, body map, phrases, voice, service worker, engine start-up, diagnostics, the evaluation wizard, recorder, metrics, replay and report, no external requests | 232 tests: 231 pass, 1 "todo" (the drift detector, M10) |
| `tests/test_server.py` (Python unittest) | Real server on a temporary database: file allow-list, host check, no CORS, JSON-only writes, size limit, validation, logs, settings, calibration, saving evaluation sessions | 37 passed |

**How the browser is tested without a browser:**
- `tests/helpers/browser-env.js` is a small fake browser (DOM, `localStorage`, `fetch`,
  timers, a controllable clock). It loads the **real** script files into Node.
- `tests/helpers/landmarks.js` and `tests/helpers/engine.js` build synthetic MediaPipe face
  landmarks, so the real engine can be driven through blinks, closures, lost faces and gaze
  movements.
- Every fix got a test that was first seen to fail on the old code.

**Node tests per file (14 Oct 2026):**

| File | Tests | File | Tests |
|---|---|---|---|
| `tests/alerts.test.js` | 13 | `tests/eval-wizard.test.js` | 14 |
| `tests/app.test.js` | 8 | `tests/gaze-features.test.js` | 5 |
| `tests/blink-select.test.js` | 12 | `tests/gaze-targets.test.js` | 4 |
| `tests/body-map.test.js` | 3 | `tests/keyboard.test.js` | 4 |
| `tests/calibration-flow.test.js` | 5 | `tests/loto-cross-val.test.js` | 7 |
| `tests/camera-stall.test.js` | 8 | `tests/no-external-requests.test.js` | 2 |
| `tests/diagnostics-app.test.js` | 8 | `tests/phrases.test.js` | 3 |
| `tests/diagnostics-module.test.js` | 11 | `tests/recording-hooks.test.js` | 6 |
| `tests/diagnostics.test.js` | 10 | `tests/scripts-load.test.js` | 3 |
| `tests/dwell.test.js` | 12 | `tests/service-worker.test.js` | 6 |
| `tests/engine-lifecycle.test.js` | 6 | `tests/sleep-mode.test.js` | 12 |
| `tests/eval-report.test.js` | 10 | `tests/store.test.js` | 10 |
| `tests/eval-tools.test.js` | 36 | `tests/voice.test.js` | 6 |
| `gaze/test_drift.js` | 4 (1 is the "todo") | `gaze/test_confidence.js` | 4 |

**The evaluation tool is tested end to end without a person.** `tests/helpers/wizard.js` runs the
real wizard on the real engine with a simulated person (who looks where asked, blinks to select,
and moves their head) and a simulated operator. Everything such a run produces is synthetic. The
wizard was also run once in real Chrome with a simulated face, which is how the camera bug was found.

**Passing tests do not mean accurate gaze.** The tests check that the code does what it was
written to do, on synthetic input: for example that a dwell is cancelled after a tracking gap.
They cannot say how close the cursor lands to where a real person looks. That needs
measurements on real sessions, which is Phase B.

**Continuous integration:** `.github/workflows/ci.yml` runs `npm test` on Node 22 and
Python 3.11 on every push. It passes on `fix/phase0-findings`. It fails on `main`, which keeps
the original CI: that checks the FastAPI rebuild, which is audit finding M13. The two newer
branches have not been pushed, so CI has not run on them; `npm test` passes on them locally.

**Not covered by automated tests:**
- A real webcam and real eyes. The camera and MediaPipe paths were checked in headless Chrome with
  a fake camera (MediaPipe loads; the no-face alarm fires once; the overlay markers line up with
  a synthetic test video; the evaluation wizard completes with a simulated face), but gaze
  accuracy with a person is unmeasured.
- Real speech output.

---

## 17. Code map

The app (branch `phase-b-eval`, 14 Oct 2026):

| File | Lines | Role |
|---|---|---|
| `index.html` | 390 | Page layout: tabs, dashboard, calibration overlay, eyes open/closed check, evaluation wizard, alarm card |
| `styles.css` | 796 | Dark amber/charcoal theme, large targets |
| `app.js` | 815 | `EyeApp`: tabs, cursor and ring, alarms and siren, calibration UI, sleep-mode UI, logs, settings, diagnostics UI |
| `gaze-engine.js` | 891 | `LumiGaze`: MediaPipe, safety monitoring, camera watchdog, blink select, sleep mode, calibration control, per-frame record |
| `gaze/gaze-features.js` | 169 | `GazeFeatures`: the 10 features, EAR, head pose, confidence (shared with the replay) |
| `gaze/ridge-regression.js` | 403 | Householder QR, polynomial features, ridge, interleaved and leave-one-target-out cross-validation, λ selection |
| `gaze/gaze-calibration.js` | 285 | Target layouts, outlier rejection, training, quality report |
| `gaze/dwell-controller.js` | 251 | Dwell state machine |
| `gaze/one-euro-filter.js` | 143 | One-Euro filter |
| `gaze/gaze-stabilizer.js` | 103 | Filter + deadband for 2-D points; the smoothing-setting mapping |
| `gaze/drift-detector.js` | 24 | Drift warning (does not work yet; M10) |
| `diagnostics.js` | 316 | `LumiDiagnostics`: camera-to-feed mapping, detection overlay, frame statistics, eyes open/closed check |
| `eval/eval-wizard.js` | 832 | `LumiEvalWizard`: the ten-stage evaluation session |
| `eval/session-recorder.js` | 304 | `LumiSessionRecorder`: one session as numbers; validation; saving |
| `eval/metrics.js` | 367 | `LumiMetrics`: accuracy, precision, p95, selection, lag; the session analysis |
| `eval/replay.js` | 357 | Node: replays sessions through the real gaze code |
| `eval/report.js` | 322 | Node: writes `eval/BASELINE.md` |
| `database.js` | 265 | `LumiStore`: API client, cache, offline queue, settings reset |
| `keyboard.js` | 157 | `LumiKeyboard`: QWERTY, suggestions, Nurse Call |
| `dictionary.js` | 173 | `LumiDictionary`: prediction and spelling suggestions |
| `body-map.js` | 206 | `LumiBodyMap`: zones, symptoms, bilingual messages |
| `phrases.js` | 49 | `LumiPhrases`: phrase board, urgent alarm |
| `voice.js` | 100 | `LumiVoice`: speech, voice choice, Hindi detection |
| `sw.js` | 73 | Service worker (network-first, offline fallback; cache `lumiiq-v7`) |
| `server.py` | 694 | Local server, API, SQLite, security, saving evaluation sessions |
| `tests/`, `gaze/test_*.js`, `gaze/_smoke.js` | ~4,800 | Tests and helpers (section 16) |
| `eval/synthetic/ear-threshold.js` | 56 | Synthetic analysis of what the EAR threshold changes, run on the real modules |

**Other files:**

| File | Status |
|---|---|
| `dlib_tracker.py` | Unused by the app |
| `validate.py`, `start.sh`, `backend/` | Belong to the FastAPI rebuild |
| `archive/` | The Eyra platform and the rebuild's frontend. Not in git; on GitHub as `LumiIQ_Eyra` / `LumiIQ_V2` |
| `shape_predictor_68_face_landmarks.dat` | 99.7 MB, unused, not in git |

---

## 18. Audit findings and their status

A read-only audit (`AUDIT.md`, 23 Sep 2026) found **35 issues**: 2 critical, 8 high, 13 medium
and 12 low. All are fixed with tests except four, which change gaze accuracy or dwell behaviour
and so need measurements first.

| ID | Problem found | Status |
|---|---|---|
| C1 | Server exposed health data and settings to the whole network | Fixed |
| C2 | Gaze could press "CAREGIVER CONFIRMED" and "Stop Gaze Camera" | Fixed |
| H1 | Dwell completed on the first frame after the eyes reopened | Fixed |
| H2 | Alarm falsely said "API webhook sent" | Fixed |
| H3 | Monitoring stopped silently (hidden tab, camera unplugged, face gone) | Fixed |
| H4 | Body map could not be used by gaze | Fixed |
| H5 | Overlapping body zones selected the wrong part | Fixed |
| H6 | Autocorrect changed meaning ("CANT"→"Want", "OK"→"Or") | Fixed |
| H7 | Stored script injection (XSS) in the dashboard | Fixed |
| H8 | Speech preferred online voices; failures were silent | Fixed (voices must be checked on the target machine) |
| M1 | Calibration quality report is optimistic | Fixed in Phase B: leave-one-target-out. Still an estimate, not a measurement (section 10.3) |
| M2 | Head movement after calibration gives large, undetected errors | **Open: Phase C** |
| M3 | A steady look re-fired the same key | Fixed |
| M4 | One frame off a target resets the dwell | **Open: Phase C** |
| M5 | Gaze clicks active before calibration | Fixed |
| M6 | Failed recalibration discarded the working model; poor ones auto-saved | Fixed |
| M7 | Each alarm logged 2–3 times | Fixed |
| M8 | Logs lost when the server was unreachable | Fixed |
| M9 | Urgent phrases neither alerted nor logged | Fixed |
| M10 | Drift detector almost never fires | **Open: Phase C** (kept as a "todo" test) |
| M11 | Eyes-closed alarm repeated every 15 s; no rest mode | Fixed (one alarm per closure + sleep mode) |
| M12 | Service worker served stale code | Fixed |
| M13 | CI tested the wrong codebase | Fixed |
| L1–L12 | Smaller issues (progress jumps, validation, dead sliders, status messages, camera errors, calibration hints, Google Fonts, TLS, double start, docs) | Fixed, except **L6 timing** (capture starts right as the dot stops: Phase B/C) |
| T1–T4 | Test files that always printed "PASS" | Fixed |

Details of every fix are in `CHANGELOG.md`; the evidence for every finding is in `AUDIT.md`.

---

## 19. Known limitations and risks

1. **Gaze accuracy is poor in real use, and unmeasured.**
   - **Observed:** the author and the supervisor have both seen it. This is a real observation,
     not a suspicion.
   - **No number yet:** no figure exists for how close the cursor lands to where the person looks.
   - **The in-app score does not help:** it is an estimate, not a measurement (section 10.3). It
     rated the saved calibration "Excellent".
   - **The tool to measure it exists now** (section 5.7), but no session has been recorded.
   - **Keys are small relative to the error:** the audit's layout measurements show that even the
     app's own optimistic figure for an earlier calibration (~180 px RMS) is larger than half a
     letter key (58–90 px, depending on screen size). **Neighbouring-key selections should be
     expected.**
2. **The EAR threshold decides what counts as an open eye** (found in Phase A, not changed).
   - With a low threshold (0.10–0.11, as saved), eyes at EAR 0.12–0.16 count as open. Such
     half-closed frames give gaze points and become calibration samples, and they never raise
     the eyes-closed alarm (**synthetic** test on the real modules).
   - The right value differs per person. The eyes open/closed check measures it.
3. **Calibration's outlier filter has a gap** (found in Phase A, not changed). A frame that is
   off in exactly 3 of the 10 features is kept as clean, and that is what an eyelid-disturbed
   frame looks like (**synthetic**: 6 of 6 kept).
4. **"Left Eye Only" probably tracks the patient's right eye** (found in Phase A, not changed).
   The engine's "left" uses MediaPipe's right-eye landmarks unless *Swap* is on. It matters for
   a patient who can use only one eye. Confirm it with the wink check (D3) before changing it.
5. **Head movement.** The model has no geometric head compensation. In synthetic tests, a 5° head
   turn after a head-still calibration gave 563–701 px of error (M2). Recalibrate after moving
   the laptop or the patient.
6. **Blink select** can be triggered by a slow involuntary blink (section 11.2).
7. **Alarms are local only.** If nobody is in earshot of the laptop, nobody is alerted. There is no
   phone, pager or nurse-station link.
8. **Monitoring needs the app visible.** Browsers pause the camera for hidden tabs. This is logged
   and reported afterwards, but monitoring is off while hidden.
9. **Light.** The camera needs some light; in the dark the no-face alarm sounds.
10. **Some targets do not scale** with screen size: the suggestion bar, the tabs, Nurse Call and
    the body zones.
11. **Speech voices** depend on the OS; check that an on-device voice exists for each language.
12. **Single user, single device, no login.** Fine locally; not ready to be put online.
13. **The evaluation tool has only been driven by simulated faces.** It is built and tested, and
    it ran end to end in Chrome, but until real sessions are recorded the dissertation's result
    tables are empty. Recording may also reveal problems a simulated face cannot, for example in
    the head-movement guidance, which depends on the sign and scale of MediaPipe's head angles.
14. **Calibration takes longer to compute** since Phase B: about 0.2 s for 9 points, 0.6 s for 16
    and 1.6 s for 25 (Node, synthetic samples). The page is frozen meanwhile.

---

## 20. Roadmap

**Rules agreed with the project owner:**
- **One branch per phase**, each created from the previous approved one. Never commit to `main`,
  never merge, no pull request unless asked.
- **Keep the stack:** plain JavaScript with no build step, a standard-library Python server on
  127.0.0.1, and no external network requests.
- **`npm test` stays green after every commit.** Every fix gets a test that first fails on the
  old code.
- **Real-person numbers are never invented, estimated or tidied.** Only numbers computed by
  code from recorded sessions count as results. A missing number stays missing.
- **Every number is labelled** "synthetic", "replayed real" or "live real".
- **No test-set tuning:** the development and held-out sessions are chosen before looking at
  results, and the split is written in an ADR.
- **Recordings stay local:** landmarks and timestamps only (no video), in a gitignored folder,
  after a consent screen.
- **Stop after each phase** and wait for approval.

| Phase | Branch | Content | Status |
|---|---|---|---|
| Audit | `fix/phase0-findings` | Read-only audit → `AUDIT.md` | **Done** (23 Sep 2026) |
| Fixes | `fix/phase0-findings` | 30 of the 35 findings fixed, each with a test → `CHANGELOG.md`. Open: M1, M2, M4, M10 and the timing part of L6 | **Done** |
| Features | `fix/phase0-findings` | Blink to select, sleep mode | **Done** |
| GitHub | — | Private repos for all seven versions | **Done** (28 Sep 2026) |
| A | `phase-a-diagnosis` | Diagnosis tools: detection overlay, frame statistics, eyes open/closed check, settings reset; written diagnosis | **Done** (30 Sep 2026); the on-screen checks have not been reported back |
| 0 | `phase-0-explain` | For the viva: `docs/EXPLAINED.md` (what the tests do and don't prove, six tests to show live, the open items); `npm run test:summary` | **Not done**: only the branch exists. The "34" → "35" correction in `AUDIT.md` was made in Phase B |
| B | `phase-b-eval` | **The evaluation tool the dissertation describes** (below) | **Built** (14 Oct 2026). **No real session recorded yet** |
| C | `phase-c-gaze` | Improve accuracy, measured against the Phase B baseline on held-out sessions | Cannot start until `eval/BASELINE.md` holds real-session numbers |
| D | `phase-d-ui` | Size the interface to the measured error; optional two-step keyboard | Only if approved |

**Phase B in more detail** (built; see section 5.7 and `docs/adr/0002-evaluation-tool.md`):
- **Evaluation wizard** on the Caregiver tab:
  1. consent;
  2. viewing distance, screen width and lighting;
  3. settings reset to defaults;
  4. a 9-point calibration;
  5. 12 held-out validation targets, including the header band, the right edge and the corners;
  6. a head-movement test;
  7. a selection test on the real keyboard, in dwell and in blink mode;
  8. a 2-minute rest period, to count false activations;
  9. lag and jitter at smoothing 0.35 and 0.06;
  10. the whole flow again with a 16-point calibration.
- **Metrics**, for x and y separately, in pixels and degrees:
  - accuracy (mean offset from the target);
  - precision (RMS spread);
  - 95th-percentile error;
  - wrong and missed selections;
  - time per correct selection;
  - false activations per minute;
  - settling time and fixation jitter.
- **Session recording** to `eval/sessions/` (gitignored), and `eval/replay.js` to run the real
  modules on recorded sessions under Node.
- **Fix M1:** grouped leave-one-target-out cross-validation for the quality report and λ.
- **`npm run eval:report`** writes `eval/BASELINE.md` with the dissertation's Tables 4.6 and 4.7.
- **`docs/RECORDING.md`:** how to record at least 3 sessions per condition, over 2 days, in 2
  lighting conditions.

**Phase C candidates,** each kept only if it beats the baseline on held-out sessions:
- a simpler model (fewer than the current 66 weights per axis);
- better handling of head movement (M2);
- a per-person EAR threshold;
- implicit recalibration from confirmed selections;
- a dwell grace period (M4), a working drift detector (M10) and settle timing (L6);
- changing the default number of calibration points only if the numbers support it.

**Later:** online deployment "after the production-ready stage" needs login, HTTPS, per-user data
separation and a data-protection review first.

**Questions the evaluation must answer** (from `AUDIT.md` §5.11):
1. What are the real accuracy and precision at targets *not* used for calibration, including the
   header and the right edge where Nurse Call sits?
2. How optimistic is the in-app report on real data?
3. How large is the error after a head movement of known size?
4. How many false selections per minute are there, how many selections are missed, and how long
   does a selection take?
5. What are the lag and jitter at the default and at the saved smoothing settings?

---

## 21. Git and GitHub

- **Local repo:** `/Users/axel/EyeCare`. Its remote `origin` is `github.com/Gautamyadav02/LumiIQ_V3`.


  | Branch | Commit | What it holds | On GitHub? |
  |---|---|---|---|
  | `main` | `9d60ece` (tag **`LumiIQ_V1`**) | The app exactly as it was before any change | Yes |
  | `fix/phase0-findings` | `b833f6c` | 18 commits of audit fixes and features | Yes |
  | `phase-a-diagnosis` | `a19be7c` | 5 more commits: the Phase A diagnosis tools and documents | **No, local only** |
  | `phase-0-explain` | `a19be7c` | Nothing new yet | **No, local only** |
  | `phase-b-eval` (current) | see `git log` | The evaluation tool, the camera fix, the M1 fix | **No, local only** |

  - To see the pushed changes:
    `https://github.com/Gautamyadav02/LumiIQ_V3/compare/main...fix/phase0-findings`.
    No pull request has been opened, and nothing has been merged.
  - **If this laptop is lost, the Phase A and Phase B work is lost,** because it is not on GitHub yet.
- **All seven repos are private** (section 3). Making any of them public is a separate decision.
  Check the repo contents first; the real databases and eye images are already excluded.
- **GitHub CLI:** `gh` on this Mac has two logins. **Gautamyadav02** is the active one, and
  KeyurTalaviya is also saved (`gh auth switch` changes the active one).

---

## 22. Design decisions and the reasons for them

| Decision | Reason |
|---|---|
| Browser app + standard-library Python, no frameworks | No installation barrier: it runs on any laptop with Python and Chrome, so it could be tested at all. The FastAPI rebuild (V2) and the Eyra platform showed that heavier stacks cost a working gaze pipeline |
| MediaPipe landmarks + a per-user regression, rather than a deep network | Runs in real time in the browser on a CPU, needs only a short calibration, and every step can be inspected and explained. The DeepGaze CNN was kept as an experiment |
| Ridge regression with degree-2 terms, solved by QR, λ by cross-validation | Few calibration samples (hundreds) and correlated features call for regularisation. QR avoids the numerical problems of the normal equations |
| One-Euro filter + deadband | A standard, tunable trade-off between jitter at rest and lag during fast eye movements |
| Dwell state machine with focus, gap, cooldown and re-arm rules | Plain "look for N ms → click" fires on everything the eyes pass over (the "Midas touch" problem) |
| Blink to select (in addition to dwell) | Requested by the project owner: faster for some users, and an easy double letter. Kept optional because it adds a risk of involuntary selections |
| Gaze clicks off until a calibration is accepted | The uncalibrated cursor is too rough and would press random keys |
| New calibration only after "Accept" | A failed or poor recalibration must never destroy a working one |
| Caregiver controls not gaze-selectable | The patient's gaze must never dismiss an alarm or stop the camera |
| Urgent phrases sound the alarm | "I can't breathe" must not depend on someone happening to hear it |
| Face-lost alarm at 10 s (5–60) | Monitoring must not stop silently when the patient leaves the frame or the camera is knocked |
| Sleep mode pauses only the eyes-closed alarm, with a 12 h limit | Sleep is normal; everything else must stay monitored, and a forgotten switch must not disable the alarm forever |
| Local-only server, no data leaving the laptop | Health and face data are special-category data. The safest design keeps it on the device |
| Offline write queue | A message or alarm must not be lost because the server was briefly down |
| Measure before changing gaze behaviour | Accuracy claims need numbers; changes to the gaze maths are kept only if they beat a recorded baseline |
| Diagnostics read a passive per-frame record (ADR 0001) | They must not be able to change gaze, dwell, blink or alarm behaviour |
| Diagnostics stay in memory, on screen (ADR 0001) | The data is face-derived and linked to a patient. Recording belongs to Phase B, behind a consent screen |
| One function maps camera coordinates onto the live feed; the canvas is not CSS-mirrored (ADR 0001) | Mirroring the canvas with CSS caused the old crosshair to be flipped twice and its text drawn backwards |
| Diagnostic text goes under the video, not over it (ADR 0001) | On the dashboard the feed is about 276×206 px; a text panel covered the eyes |

---

## 23. Other documents in this folder

| Document | Status |
|---|---|
| `detail.md` | This overview |
| `README.md` | Current; how to run, API, features |
| `AUDIT.md` | Current; the verified audit with evidence and reproduction scripts (they reproduce the **original** behaviour; run them at tag `LumiIQ_V1`) |
| `CHANGELOG.md` | Current; every fix, test and design decision since the audit |
| `docs/diagnosis/phase-a.md` | Current; the Phase A diagnosis and the on-screen checks (D1–D6, M1–M3) |
| `docs/adr/0001-caregiver-diagnostics.md` | Current; the design decisions behind the diagnostics |
| `docs/RECORDING.md` | Current; how to record evaluation sessions, step by step |
| `docs/adr/0002-evaluation-tool.md` | Current; the design decisions behind the evaluation tool |
| `eval/BASELINE.md` | Generated by `npm run eval:report`. **Empty until sessions are recorded** |
| `docs/EXPLAINED.md` | **Does not exist yet** (Phase 0) |
| `PROJECT.md` | Partly out of date (has a banner) |
| `README_V3.md`, `SETUP_GUIDE.md`, `docs/IMPLEMENTATION_GUIDE.md` | Describe the FastAPI rebuild; **out of date**, with banners |
| `SYSTEM_READY.md`, `IMPLEMENTATION_COMPLETE.md` | Describe the FastAPI rebuild with unsupported claims ("production-ready", accuracy percentages that were never measured). **Do not quote them** |
| `research_and_brainstorm.md` | Early research notes (has a banner) |

---

## 24. Glossary

| Term | Meaning |
|---|---|
| **AAC** | Augmentative and Alternative Communication: tools that replace or support speech |
| **Dwell** | Selecting by looking at a target for a set time |
| **Midas touch** | The problem that everything you look at gets selected |
| **EAR** | Eye Aspect Ratio: eye height ÷ eye width; small when the eye is closed |
| **Landmarks** | The 478 points MediaPipe places on the face, including the iris centres |
| **Yaw / pitch / roll** | Head turning left–right / nodding up–down / tilting sideways |
| **Ridge regression** | Least-squares fitting with a penalty (λ) on large weights, to avoid overfitting |
| **Polynomial features (degree 2)** | The original numbers plus their squares and pairwise products, so a linear model can fit curves |
| **Householder QR** | A numerically stable way to solve least-squares problems |
| **Cross-validation (k-fold)** | Split the data into k parts; train on k−1, test on the one left out; repeat |
| **R²** | Share of the variation explained by the model (1 = all, 0 = none) |
| **RMS error** | Root-mean-square distance between predicted and true positions |
| **Accuracy** | How far, on average, the gaze estimate is from the target (mean offset) |
| **Precision** | How much the gaze estimate scatters around its own average while the eye is still (RMS spread) |
| **Held-out targets** | Targets shown after calibration that the model never saw, used to measure real error |
| **Degrees of visual angle** | Error measured as an angle at the eye, so results compare across screen sizes and distances |
| **MAD** | Median absolute deviation: a robust measure of spread, used to find outlier frames |
| **One-Euro filter** | An adaptive low-pass filter: smooth when still, responsive when moving |
| **Deadband** | Movements smaller than this are ignored |
| **FSM** | Finite-state machine: a fixed set of states with rules for moving between them |
| **Service worker** | Browser script that caches files so a web app opens offline |
| **CORS** | The browser rule that decides whether one website may read another's responses |
| **DNS rebinding** | An attack where a web page makes the browser talk to a server on your own machine |
| **XSS** | Cross-site scripting: text that a page mistakenly runs as code |
| **ADR** | Architecture Decision Record: a short document explaining one design decision |
