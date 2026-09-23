# LumiIQ — Project Overview

Eye-gaze assistive communication system for paralyzed, bed-ridden, or locked-in
patients. Tracks gaze via a standard webcam (MediaPipe Face Landmarker), drives a
dwell-to-click UI (predictive keyboard, anatomical body map for symptom reporting,
loud bilingual text-to-speech, and automatic safety alarms for prolonged eye closure
or rapid blinking).

This repo (`/Users/axel/LumiIQ`, not under git at the root) actually contains
**three separate codebases** at different stages of maturity. They share ideas and
some file names but are not layered on top of each other — pick the right one before
making changes.

| Codebase | Location | Status |
|---|---|---|
| **v1** | root (`index.html`, `app.js`, `gaze-engine.js`, `gaze/`, `server.py`) | Working end-to-end, has real usage data in `lumiiq.db` |
| **v3 standalone** | `backend/` + `frontend/` | Runs as a static server; gaze tracking is **not wired up** in the frontend, CV pipeline is unreachable |
| **platform (Eyra / LumiIQ)** | `platform/` | SaaS rewrite, substantial backend/frontend code, but no tests, empty schema/repo dirs, never committed to git |

---

## 1. v1 — root app (the one that works)

Zero-dependency, stdlib-only Python server plus vanilla JS. No build step, no `pip
install`.

```bash
cd /Users/axel/LumiIQ
python3 server.py        # http://localhost:8000
```

- `index.html` — page shell; loads scripts in order: `database.js` → `dictionary.js`
  → `voice.js` → `gaze/*` → `gaze-engine.js` → `keyboard.js` → `body-map.js` →
  `app.js`.
- `app.js` — app/tab controller, dwell-hover UI, siren/alarm handling.
- `gaze-engine.js` — orchestrates MediaPipe + calibration + stabilizer + dwell
  pipeline.
- `gaze/` — **Gaze Engine V3** math/control modules: `ridge-regression.js`,
  `one-euro-filter.js`, `gaze-stabilizer.js`, `dwell-controller.js`,
  `gaze-calibration.js`. Pipeline: MediaPipe landmarks → ridge regression over
  degree-2 polynomial features → One-Euro filter → dwell FSM.
  - Tests: `gaze/test_gaze.js`, 28 assertions across 9 sections. No Node on this
    machine — run with JavaScriptCore:
    `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc gaze/test_gaze.js`
- `keyboard.js` — on-screen QWERTY, predictive suggestions, autocorrect, Nurse Call,
  SPEAK key.
- `body-map.js` — anatomical SVG body map (front/back) → symptom grid → voice alert.
- `voice.js` — wraps SpeechSynthesis; max volume, auto-selects clearest voice,
  auto-detects Hindi vs. English per phrase.
- `database.js` — REST client for `server.py`, in-memory cache with `localStorage`
  fallback so the 30fps gaze loop never blocks on the network.
- `server.py` — `ThreadingHTTPServer`, no third-party deps, serves static files +
  a JSON REST API (`/api/settings`, `/api/calibration`, `/api/logs/*`) backed by
  `lumiiq.db`.

## 2. v3 standalone — `backend/` + `frontend/`

A second attempt at a proper FastAPI backend, serving an adapted copy of the v1
frontend.

```bash
cd /Users/axel/LumiIQ/backend
pip install -r requirements.txt   # fastapi, sqlalchemy, mediapipe, opencv-python, scikit-learn
python3 server.py                 # mounts frontend/ at /static
```

- `backend/app/main.py` — 21 plain FastAPI routes (no routers, no websocket).
- `backend/app/vision/gaze_engine.py` — MediaPipe-based CV pipeline (461 lines).
- `backend/app/services/__init__.py` — `GazeService.process_frame()` is a literal
  `pass` stub; nothing feeds camera frames into it, so the CV/regression code is
  currently unreachable from the running app.
- `frontend/` — adapted variants of `app.js`/`keyboard.js`/`body-map.js`/`voice.js`.
  **`frontend/index.html` never loads `gaze-engine.js` or `gaze/*.js`** — there is no
  client-side gaze tracking wired up here yet.
- `backend/tests/` exists but is empty — no tests actually written.
- `dependencies not currently installed` in this environment (`import fastapi`
  fails) — hasn't been run recently in its current form.

Treat this codebase as UI-only scaffolding around v1's widgets, not a working gaze
system.

## 3. platform/ — Eyra / LumiIQ SaaS rewrite

The commercial multi-tenant rewrite: FastAPI + PostgreSQL backend, React 18 +
TypeScript + Vite + Tailwind frontend. **This directory is its own nested git repo
with zero commits** — everything is currently staged/untracked, separate from any
version control at the LumiIQ root.

```bash
cd /Users/axel/LumiIQ/platform
docker compose up   # postgres, redis, api (FastAPI), frontend (vite dev)
```

### Backend (`platform/backend/app`)
- Real route modules: `api/v1/routes/{admin,alerts,auth,calibration,caregiver,
  dashboard,patients,phrases,sessions}.py`
- 13 SQLAlchemy model files under `db/models/` (user, patient, tenant,
  organisation, device, session, calibration, alert, message, notification,
  phrase, body_map, audit); one Alembic migration (`0001_initial_schema.py`)
- Auth: JWT access + refresh rotation, Argon2id, RBAC, lockout
- **Gaps:** `db/repositories/` and `app/schemas/` directories exist but are
  **empty**; `tests/unit` and `tests/integration` exist but are **empty**;
  `calibration.py` route is a 4-line stub that just re-points to `patients.py`.

### Frontend (`platform/frontend/src`)
- `pages/{admin,caregiver,patient,public}`, `features/communication/*`,
  `features/gaze/GazeProvider.tsx`, `store/auth.ts` (Zustand)
- `src/gaze/` — full TypeScript port of the gaze engine: `types.ts`,
  `ridge-regression.ts`, `calibration.ts`, `one-euro-filter.ts`,
  `dwell-controller.ts`, `engine.ts`, `index.ts`
- `public/locales/` — all 20 locales present with real content (en-GB, en-US, hi,
  gu, pa, mr, bn, ta, te, ml, kn, ur, ne, ru, zh, ar, fr, de, es, pl), 4 namespaces
  each
- `package.json` name is `lumiiq-frontend` — branding has drifted from "Eyra" to
  "LumiIQ" in this package but not everywhere else; verify current brand name
  before using either in user-facing copy.
- Deps: React 18.3.1, react-router-dom 6.28, @tanstack/react-query 5.62, zustand
  5.0.2, i18next 24.2, vite 6.0.5, tailwindcss 3.4.17, TypeScript 5.7.2

### Infra
- `platform/docker-compose.yml` defines postgres, redis, `api`, `frontend` — looks
  coherent but is untested (no CI, no lockfiles committed).
- `platform/infra/` subdirs (`docker/`, `terraform/`, `scripts/`) exist but are
  **empty**.

**Bottom line:** substantial, non-stub backend and frontend code, but zero test
coverage, empty schema/repository layers, one stub route, and no git history. This
is mid-build, not production-ready — despite what some root-level docs imply.

---

## Shared database

`lumiiq.db` (SQLite, WAL mode) sits at the repo root and is used by **both v1 and
v3 standalone**. Its data makes the maturity gap obvious: v1 tables (`kv`,
`typed_logs`, `symptom_logs`, `alert_logs`) have real rows from actual use (28
alerts, 6 typed logs, 2 symptom logs). All v3 tables (`patients`, `sessions`,
`calibrations`, `communications`, `symptom_reports`, `alerts`, `analytics`,
`patient_settings`) have **zero rows** — v3 has not actually been exercised.
`platform/` uses PostgreSQL and is unrelated to this file.

## Existing docs — what to trust

`README.md`, `README_V3.md`, `SETUP_GUIDE.md`, `SYSTEM_READY.md`, and
`IMPLEMENTATION_COMPLETE.md` all live at the root and overlap heavily. Only
`README.md` describes v1 (accurate). The other four describe v3 in
marketing/status-report language ("PRODUCTION-READY", "COMPLETE") that predates —
and is contradicted by — the empty `backend/tests/` directory and the disconnected
gaze pipeline described above. Treat those four as historical/aspirational, not
current status.

`docs/IMPLEMENTATION_GUIDE.md` (root `docs/`, not `platform/docs/`) is a v3-scoped
checklist; despite the generic name it has nothing to do with `platform/`.
`platform/docs/` itself is empty.

## Testing

- v1 gaze math: `jsc gaze/test_gaze.js` (28 assertions, no Node on this machine).
- v3 standalone: no tests exist (`backend/tests/` is empty).
- platform: no tests exist (`tests/unit`, `tests/integration` are empty despite
  the directories being present).
