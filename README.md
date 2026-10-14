# LumiIQ — Eye-Gaze Communication & Safety System

LumiIQ is a browser-based eye-gaze communication aid for people who are paralysed,
bed-bound or locked-in. It uses a standard webcam (no special hardware) and a small
local Python server that stores settings and logs in SQLite.

It is a research prototype, not a medical device. Its gaze accuracy has not yet been
measured; see [AUDIT.md](AUDIT.md) for a verified description and known limitations,
and [CHANGELOG.md](CHANGELOG.md) for the fixes made since.

---

## 🏗 Architecture

```
Browser (front-end)                Python server (server.py)         SQLite (lumiiq.db)
─────────────────────              ──────────────────────────         ───────────────────
index.html / *.js / styles.css ──► GET  /                  ──► static files
LumiStore (cache + fetch)       ──► GET/PUT /api/settings    ──► kv table
LumiGaze (calibration)          ──► GET/PUT /api/calibration ──► kv table
keyboard / body-map / alerts   ──► GET     /api/logs        ──► typed/symptom/alert tables
                                   POST    /api/logs/*
```

The front-end keeps an in-memory cache, so the ~30 fps gaze loop never waits on the
network. Writes are queued in `localStorage` until the server confirms them, so
messages and alerts are not lost if the server is briefly unreachable.

---

## 🚀 How to Run (no installation needed)

Everything uses the Python **standard library only** — no `pip install`.

```bash
cd path/to/this/folder
python3 server.py            # http://localhost:8000 — reachable from this computer only
python3 server.py 9000       # another port
```

Then in Chrome:
1. Open **`http://localhost:8000`**
2. Go to the **⚙ Caregiver** tab → **Start Gaze Camera** (allow webcam)
3. Sit 0.5–1 m from the camera → **Calibrate Gaze Engine** → follow the orange dot

(`start.sh` starts the separate, out-of-scope v3 backend — not this app.)

---

## 🔌 REST API

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| GET    | `/api/health`        | —                          | Liveness check |
| GET    | `/api/settings`      | —                          | Read all settings |
| PUT    | `/api/settings`      | partial settings object    | Merge & save settings |
| GET    | `/api/calibration`   | —                          | Read calibration points |
| PUT    | `/api/calibration`   | calibration object         | Save calibration |
| GET    | `/api/logs`          | —                          | `{ typed, symptom, alert }` |
| POST   | `/api/logs/typed`    | `{ text }`                 | Log a spoken sentence |
| POST   | `/api/logs/symptom`  | `{ bodyPart, symptom }`    | Log a reported symptom |
| POST   | `/api/logs/alert`    | `{ type, details }`        | Log a safety alert |
| POST   | `/api/eval/session`  | one evaluation session     | Save it to `eval/sessions/` (never served back) |
| DELETE | `/api/logs`          | —                          | Clear all logs |

All endpoints return JSON. Log entries accept an optional ISO-8601 `timestamp` (the
event time, used when entries were queued offline). The server listens on 127.0.0.1
only, sends no CORS headers, requires `Content-Type: application/json` for writes,
validates every stored value, and serves only the app's own files — see the security
notes at the top of `server.py`.

---

## 🗄 Database (SQLite — `lumiiq.db`)

Created automatically on first launch.

- `kv` — settings & calibration (JSON blobs keyed by name)
- `typed_logs` — last 200 spoken sentences
- `symptom_logs` — last 200 reported symptoms
- `alert_logs` — last 100 safety alerts

To reset everything, just delete `lumiiq.db` (or `DELETE /api/logs` to clear logs only).

---

## 🔊 Voice — loud & clear

`voice.js` (`LumiVoice`) wraps the browser SpeechSynthesis API:
- **Volume maxed to 1.0 by default** (adjustable via the *Voice Volume* slider)
- Prefers voices that run on this device (online voices fail without internet and
  send the text to a cloud service); speech failures show a visible warning
- Auto-detects Hindi (Devanagari) vs English per phrase
- Works around Chrome's "stuck speech" bug (auto-resume)

---

## 🛠 Features

1. **Gaze selection** — look at a target until the progress ring completes (dwell), or
   look at it and close your eyes deliberately for about 0.5 s (blink to select). The
   caregiver chooses "dwell or blink", "dwell only" or "blink only". To repeat a key,
   look away and back, or blink again.
2. **Virtual QWERTY Keyboard** — word predictions and spelling suggestions (never
   applied automatically), **Nurse Call**, and a **SPEAK** key (bilingual TTS).
3. **Anatomical Body Map** — SVG zones (Head, Eyes, Throat, Chest, Stomach, Arms, Legs,
   Back) → symptom grid (Pain, Itching, Numbness, Spasm, Cold, Hot) → instant voice alert.
4. **Safety Alarms** — rapid blinking (6× in 3 s), prolonged eye closure (≥ 3 s), no
   face detected for a set time (default 10 s), a disconnected camera, Nurse Call and
   Urgent phrases sound a siren **on this device** and are recorded in the safety log.
   No message is sent to anyone else.
5. **Sleep mode** — a caregiver button for when the patient sleeps: pauses only the
   eyes-closed alarm (other alarms stay on); waking or any selection is reported with a
   chime and a Safety Alerts entry. Ends automatically after 12 hours.
6. **Caregiver Dashboard** — live camera feed, calibration, sleep mode, patient timeline,
   safety alerts, and tuning (dwell time, selection method, smoothing, active eye, EAR
   threshold, voice), with a reset to defaults.
7. **Diagnostics (caregiver only)** — a detection overlay on the live feed (iris centres,
   EAR per eye, head pose, why a frame gave no gaze point), frame statistics, and a guided
   eyes open/closed check for the EAR threshold. Nothing is saved or sent. See
   [docs/diagnosis/phase-a.md](docs/diagnosis/phase-a.md).
8. **Evaluation session (caregiver only)** — a guided, consented 10-minute session that measures
   accuracy on targets not used for calibration, the effect of head movement, selection by dwell
   and by blink, false activations and lag. It records numbers only, never video, into
   `eval/sessions/` on this computer. `npm run eval:report` turns the sessions into
   `eval/BASELINE.md`. See [docs/RECORDING.md](docs/RECORDING.md).

---

## 📂 Files

| File | Role |
|------|------|
| `server.py`     | Python backend: static hosting + REST API + SQLite |
| `start.sh`      | Launcher for the separate v3 backend (not this app) |
| `index.html`    | App layout & dashboard |
| `styles.css`    | Amber/charcoal low-strain theme |
| `app.js`        | Controller (`EyeApp`) — tabs, sirens, calibration, logs |
| `gaze-engine.js`| MediaPipe gaze tracking (`LumiGaze`) |
| `voice.js`      | Loud & clear TTS (`LumiVoice`) |
| `keyboard.js`   | QWERTY + prediction (`LumiKeyboard`) |
| `body-map.js`   | Body map & symptoms (`LumiBodyMap`) |
| `dictionary.js` | Prediction + spelling suggestions (`LumiDictionary`) |
| `database.js`   | API client, cache and offline write queue (`LumiStore`) |
| `diagnostics.js` | Caregiver diagnostics: feed overlay, frame statistics, EAR check (`LumiDiagnostics`) |
| `gaze/gaze-features.js` | Feature extraction, shared by the app and the offline replay (`GazeFeatures`) |
| `eval/eval-wizard.js` | The evaluation wizard (`LumiEvalWizard`) |
| `eval/session-recorder.js` | Records a session as numbers (`LumiSessionRecorder`) |
| `eval/metrics.js` | Accuracy, precision, selection and lag metrics (`LumiMetrics`) |
| `eval/replay.js` | Node: replays recorded sessions through the real gaze code |
| `eval/report.js` | Node: writes `eval/BASELINE.md` |
| `eval/ablation.js` | Node: writes `eval/IMPROVEMENTS.md` (each Phase C change against the baseline) |

## ✅ Tests

```bash
npm test              # JavaScript unit tests + server integration tests; nothing to install
npm run eval:report   # eval/BASELINE.md from the recorded sessions in eval/sessions/
npm run eval:ablation # eval/IMPROVEMENTS.md: each Phase C change against the baseline, on held-out sessions
```
