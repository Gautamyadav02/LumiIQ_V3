# LumiIQ — Eye-Gaze Communication & Safety System

LumiIQ is a web-based, state-of-the-art eye-gaze assistive technology for paralyzed,
bed-ridden, or locked-in patients. It runs in any modern browser using a standard
webcam — no special hardware — and is now backed by a **proper Python server with a
real SQLite database and a JSON REST API**.

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

The front-end keeps a synchronous in-memory cache (so the 30fps gaze loop never waits
on the network) and **falls back to `localStorage`** if the server is briefly
unreachable — so the patient UI never freezes or crashes.

---

## 🚀 How to Run (no installation needed)

Everything uses the Python **standard library only** — no `pip install`.

```bash
cd /Users/axel/LumiIQ
python3 server.py            # http://localhost:8000
# or choose a port:
python3 server.py 9000
```

Then in Chrome:
1. Open **`http://localhost:8000`**
2. Go to the **⚙ Caregiver** tab → **Start Gaze Camera** (allow webcam)
3. Sit 0.5–1 m from the camera → **Calibrate Gaze Engine** → follow the orange dot

(`./start.sh` does the same thing.)

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
| DELETE | `/api/logs`          | —                          | Clear all logs |

All endpoints return JSON and send permissive CORS headers. The server is threaded
and wraps every handler in try/except, so a malformed request can never take it down.

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
- Auto-selects the clearest/most natural available voice for the language
- Auto-detects Hindi (Devanagari) vs English per phrase
- Works around Chrome's "stuck speech" bug (auto-resume)

---

## 🛠 Features

1. **Gaze-Dwell Clicking** — dwell on any `.gazeable` element; a conic progress ring
   sweeps and auto-clicks at 100%.
2. **Virtual QWERTY Keyboard** — predictive suggestions, autocorrect, **Nurse Call**
   pager, and a **SPEAK** key (loud bilingual TTS).
3. **Anatomical Body Map** — SVG zones (Head, Eyes, Throat, Chest, Stomach, Arms, Legs,
   Back) → symptom grid (Pain, Itching, Numbness, Spasm, Cold, Hot) → instant voice alert.
4. **Automatic Safety Alarms** — rapid blinking (6× in 3s) and prolonged eye closure
   (≥3s) trigger a Web-Audio siren + caregiver alert logged to the database.
5. **Caregiver Dashboard** — live camera feed, calibration, patient timeline, safety
   alerts, and full tuning (dwell time, smoothing, active eye, EAR threshold, voice).

---

## 📂 Files

| File | Role |
|------|------|
| `server.py`     | Python backend: static hosting + REST API + SQLite |
| `start.sh`      | Convenience launcher |
| `index.html`    | App layout & dashboard |
| `styles.css`    | Amber/charcoal low-strain theme |
| `app.js`        | Controller (`EyeApp`) — tabs, sirens, calibration, logs |
| `gaze-engine.js`| MediaPipe gaze tracking (`LumiGaze`) |
| `voice.js`      | Loud & clear TTS (`LumiVoice`) |
| `keyboard.js`   | QWERTY + prediction (`LumiKeyboard`) |
| `body-map.js`   | Body map & symptoms (`LumiBodyMap`) |
| `dictionary.js` | Prediction + autocorrect (`LumiDictionary`) |
| `database.js`   | API client + cache (`LumiStore`) |
