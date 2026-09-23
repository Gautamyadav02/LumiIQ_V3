#!/usr/bin/env python3
"""
LumiIQ — Backend Server (zero external dependencies)

A small but robust HTTP server built ONLY on the Python standard library so it
runs anywhere with no `pip install` step:

  * Static file hosting for the front-end (index.html, css, js)
  * A JSON REST API backed by a real SQLite database (lumiiq.db)
  * Threaded so multiple requests never block each other

Run:
    python3 server.py            # serves on http://localhost:8000
    python3 server.py 9000       # custom port

API:
    GET    /api/health                 -> { status, time }
    GET    /api/settings               -> settings object
    PUT    /api/settings               -> merge + save settings
    GET    /api/calibration            -> calibration object | null
    PUT    /api/calibration            -> save calibration
    GET    /api/logs                   -> { typed:[], symptom:[], alert:[] }
    POST   /api/logs/typed   {text}
    POST   /api/logs/symptom {bodyPart, symptom}
    POST   /api/logs/alert   {type, details}
    DELETE /api/logs                   -> clears every log table
"""

import json
import os
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "lumiiq.db")

# Serialise writes so concurrent threads never corrupt SQLite.
_DB_LOCK = threading.Lock()

DEFAULT_SETTINGS = {
    "dwellTimeMs": 1200,
    "smoothingFactor": 0.35,
    "activeEye": "both",
    "earThreshold": 0.18,
    "gazeSensitivityX": 1.2,
    "gazeSensitivityY": 1.2,
    "voiceRate": 0.95,
    "voicePitch": 1.0,
    "voiceVolume": 1.0,           # loud & clear by default
    "voiceLanguage": "en-US",
    "alarmVolume": 0.7,
    "emergencyContacts": "Nurse Dashboard, +1 (555) 019-9111",
    "swapEyes": False,
}

TYPED_LIMIT = 200
SYMPTOM_LIMIT = 200
ALERT_LIMIT = 100


# ───────────────────────────────────────────────────────────
#  DATABASE
# ───────────────────────────────────────────────────────────
def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    with _DB_LOCK, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS kv (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS typed_logs (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                text      TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS symptom_logs (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                body_part TEXT NOT NULL,
                symptom   TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alert_logs (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                type      TEXT NOT NULL,
                details   TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            """
        )
        # Seed default settings on first boot.
        row = conn.execute("SELECT value FROM kv WHERE key='settings'").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO kv (key, value) VALUES ('settings', ?)",
                (json.dumps(DEFAULT_SETTINGS),),
            )
    print(f"[LumiIQ] SQLite database ready at {DB_PATH}")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_settings():
    with _DB_LOCK, _connect() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key='settings'").fetchone()
    stored = json.loads(row["value"]) if row else {}
    # Always merge over defaults so new keys appear for old databases.
    return {**DEFAULT_SETTINGS, **stored}


def save_settings(patch):
    current = get_settings()
    current.update(patch or {})
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('settings', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(current),),
        )
    return current


def get_calibration():
    with _DB_LOCK, _connect() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key='calibration'").fetchone()
    return json.loads(row["value"]) if row else None


def save_calibration(points):
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('calibration', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(points),),
        )
    return points


def _trim(conn, table, limit):
    conn.execute(
        f"DELETE FROM {table} WHERE id NOT IN "
        f"(SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
        (limit,),
    )


def add_typed(text):
    ts = now_iso()
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO typed_logs (text, timestamp) VALUES (?, ?)", (text, ts)
        )
        _trim(conn, "typed_logs", TYPED_LIMIT)
    return {"text": text, "timestamp": ts}


def add_symptom(body_part, symptom):
    ts = now_iso()
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO symptom_logs (body_part, symptom, timestamp) VALUES (?, ?, ?)",
            (body_part, symptom, ts),
        )
        _trim(conn, "symptom_logs", SYMPTOM_LIMIT)
    return {"bodyPart": body_part, "symptom": symptom, "timestamp": ts}


def add_alert(atype, details):
    ts = now_iso()
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO alert_logs (type, details, timestamp) VALUES (?, ?, ?)",
            (atype, details, ts),
        )
        _trim(conn, "alert_logs", ALERT_LIMIT)
    # Real systems would forward this to a caregiver webhook / SMS gateway here.
    print(f"[ALERT] {atype}: {details}")
    return {"type": atype, "details": details, "timestamp": ts}


def get_logs():
    with _DB_LOCK, _connect() as conn:
        typed = [
            {"id": f"log_{r['id']}", "text": r["text"], "timestamp": r["timestamp"]}
            for r in conn.execute(
                "SELECT * FROM typed_logs ORDER BY id DESC"
            ).fetchall()
        ]
        symptom = [
            {
                "id": f"sym_{r['id']}",
                "bodyPart": r["body_part"],
                "symptom": r["symptom"],
                "timestamp": r["timestamp"],
            }
            for r in conn.execute(
                "SELECT * FROM symptom_logs ORDER BY id DESC"
            ).fetchall()
        ]
        alert = [
            {
                "id": f"alert_{r['id']}",
                "type": r["type"],
                "details": r["details"],
                "timestamp": r["timestamp"],
            }
            for r in conn.execute(
                "SELECT * FROM alert_logs ORDER BY id DESC"
            ).fetchall()
        ]
    return {"typed": typed, "symptom": symptom, "alert": alert}


def clear_logs():
    with _DB_LOCK, _connect() as conn:
        conn.execute("DELETE FROM typed_logs")
        conn.execute("DELETE FROM symptom_logs")
        conn.execute("DELETE FROM alert_logs")
    return {"cleared": True}


# ───────────────────────────────────────────────────────────
#  HTTP HANDLER
# ───────────────────────────────────────────────────────────
class LumiIQHandler(SimpleHTTPRequestHandler):
    server_version = "LumiIQ/2.0"

    # ---- helpers --------------------------------------------------
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, json.JSONDecodeError):
            return {}

    def _is_api(self):
        return self.path.split("?")[0].startswith("/api/")

    # ---- verbs ----------------------------------------------------
    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self._is_api():
            return self._api_get()
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        if self._is_api():
            return self._api_post()
        self._send_json({"error": "Not found"}, 404)

    def do_PUT(self):  # noqa: N802
        if self._is_api():
            return self._api_put()
        self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):  # noqa: N802
        if self._is_api():
            return self._api_delete()
        self._send_json({"error": "Not found"}, 404)

    # ---- API routing ----------------------------------------------
    def _api_get(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/health":
                return self._send_json({"status": "ok", "time": now_iso()})
            if path == "/api/settings":
                return self._send_json(get_settings())
            if path == "/api/calibration":
                return self._send_json(get_calibration())
            if path == "/api/logs":
                return self._send_json(get_logs())
        except Exception as exc:  # never crash the server on a bad request
            return self._send_json({"error": str(exc)}, 500)
        self._send_json({"error": "Unknown endpoint"}, 404)

    def _api_post(self):
        path = self.path.split("?")[0]
        data = self._read_json()
        try:
            if path == "/api/logs/typed":
                text = (data.get("text") or "").strip()
                if not text:
                    return self._send_json({"error": "text required"}, 400)
                return self._send_json(add_typed(text), 201)
            if path == "/api/logs/symptom":
                bp = data.get("bodyPart")
                sym = data.get("symptom")
                if not bp or not sym:
                    return self._send_json({"error": "bodyPart & symptom required"}, 400)
                return self._send_json(add_symptom(bp, sym), 201)
            if path == "/api/logs/alert":
                at = data.get("type")
                det = data.get("details", "")
                if not at:
                    return self._send_json({"error": "type required"}, 400)
                return self._send_json(add_alert(at, det), 201)
        except Exception as exc:
            return self._send_json({"error": str(exc)}, 500)
        self._send_json({"error": "Unknown endpoint"}, 404)

    def _api_put(self):
        path = self.path.split("?")[0]
        data = self._read_json()
        try:
            if path == "/api/settings":
                return self._send_json(save_settings(data))
            if path == "/api/calibration":
                return self._send_json(save_calibration(data))
        except Exception as exc:
            return self._send_json({"error": str(exc)}, 500)
        self._send_json({"error": "Unknown endpoint"}, 404)

    def _api_delete(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/logs":
                return self._send_json(clear_logs())
        except Exception as exc:
            return self._send_json({"error": str(exc)}, 500)
        self._send_json({"error": "Unknown endpoint"}, 404)

    # Quieter, tidier logging.
    def log_message(self, fmt, *args):
        sys.stderr.write("[LumiIQ] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Invalid port '{sys.argv[1]}', using 8000")
    init_db()
    handler = partial(LumiIQHandler, directory=BASE_DIR)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"[LumiIQ] Server running:  http://localhost:{port}")
    print("[LumiIQ] Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[LumiIQ] Shutting down…")
        httpd.server_close()


if __name__ == "__main__":
    main()
