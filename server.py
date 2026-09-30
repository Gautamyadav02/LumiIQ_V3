#!/usr/bin/env python3
"""
LumiIQ — local server (Python standard library only, no `pip install`)

  * Serves the app's own files — an explicit allow-list, so the databases,
    source code, dotfiles and folder listings are never served
  * A JSON REST API backed by SQLite (lumiiq.db)
  * Listens on 127.0.0.1 by default: only this computer can connect

Run:
    python3 server.py                  # http://localhost:8000
    python3 server.py 9000             # custom port
    python3 server.py --db other.db    # another database file (tests use this)

API (requests that write must send Content-Type: application/json):
    GET    /api/health                 -> { status, time }
    GET    /api/settings               -> settings object
    PUT    /api/settings               -> validate, merge + save settings
    GET    /api/calibration            -> calibration object | null
    PUT    /api/calibration            -> validate + save calibration
    GET    /api/logs                   -> { typed:[], symptom:[], alert:[] }
    POST   /api/logs/typed   {text, timestamp?}
    POST   /api/logs/symptom {bodyPart, symptom, timestamp?}
    POST   /api/logs/alert   {type, details, timestamp?}
    DELETE /api/logs                   -> clears every log table

Security model (the server stores health data and has no login):
  1. Bind to loopback, so other devices cannot connect.
  2. On loopback, only accept requests addressed to localhost/127.0.0.1 —
     this defeats "DNS rebinding" (a web page pointing its own domain at
     this machine).
  3. Send no CORS headers and require JSON for writes, so other web pages
     open in the same browser can neither read the API nor write to it.
  4. Serve only allow-listed app files.
  5. Validate every value that is stored.
"""

import argparse
import ipaddress
import json
import logging
import math
import os
import posixpath
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Module-level so tests (and --db) can point the server at another file.
DB_PATH = os.environ.get("LUMIIQ_DB", os.path.join(BASE_DIR, "lumiiq.db"))

log = logging.getLogger("lumiiq")

# Serialise database access so concurrent request threads never interleave writes.
_DB_LOCK = threading.Lock()

MAX_BODY_BYTES = 256 * 1024   # a saved calibration is ~9 KB

# The only settings the server stores, with the values each may take.
# kind "number" -> (min, max); "choice" -> allowed values; "bool" -> True/False.
SETTINGS_SCHEMA = {
    "dwellTimeMs":     ("number", (300, 5000)),
    "smoothingFactor": ("number", (0.05, 0.45)),
    "activeEye":       ("choice", {"both", "left", "right"}),
    "earThreshold":    ("number", (0.05, 0.40)),
    "voiceRate":       ("number", (0.5, 2.0)),
    "voicePitch":      ("number", (0.5, 2.0)),
    "voiceVolume":     ("number", (0.0, 1.0)),
    "voiceLanguage":   ("choice", {"en-US", "en-GB", "hi-IN"}),
    "alarmVolume":     ("number", (0.0, 1.0)),
    "faceLostAlarmSec": ("number", (5, 120)),
    "selectionMode":   ("choice", {"both", "dwell", "blink"}),
    "blinkSelectMs":   ("number", (300, 1200)),
    "dwellRepeat":     ("bool", None),
    "sleepWakeSec":    ("number", (2, 60)),
    "sleepModeUntil":  ("number", (0, 1e13)),   # epoch ms; the app never sets it > 12 h ahead
    "swapEyes":        ("bool", None),
}

DEFAULT_SETTINGS = {
    "dwellTimeMs": 1200,
    "smoothingFactor": 0.35,
    "activeEye": "both",
    "earThreshold": 0.18,
    "voiceRate": 0.95,
    "voicePitch": 1.0,
    "voiceVolume": 1.0,           # loud & clear by default
    "voiceLanguage": "en-US",
    "alarmVolume": 0.7,
    "faceLostAlarmSec": 10,
    "selectionMode": "both",      # select by dwell or by a deliberate blink
    "blinkSelectMs": 500,         # eyes closed at least this long = a deliberate blink
    "dwellRepeat": False,         # keep looking at a key to repeat it
    "sleepWakeSec": 5,            # sleep mode: eyes open this long = activity report
    "sleepModeUntil": 0,          # sleep mode end time (epoch ms); 0 = off
    "swapEyes": False,
}

TYPED_LIMIT = 200
SYMPTOM_LIMIT = 200
ALERT_LIMIT = 100

ALERT_TYPE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,39}$")

# Files the browser app needs. Everything else in the folder is private.
STATIC_FILES = {
    "/", "/index.html", "/styles.css", "/manifest.json", "/sw.js", "/favicon.ico",
    "/app.js", "/database.js", "/dictionary.js", "/voice.js", "/gaze-engine.js",
    "/keyboard.js", "/body-map.js", "/phrases.js", "/diagnostics.js",
}
STATIC_DIRS = {
    "/gaze/": {".js"},
    "/lib/mediapipe/": {".js", ".mjs", ".cjs", ".wasm", ".map"},
    "/models/": {".task"},
    "/icons/": {".png"},
}


class ValidationError(ValueError):
    """A request value that must not be stored; reported to the client as HTTP 400."""


# ───────────────────────────────────────────────────────────
#  DATABASE
# ───────────────────────────────────────────────────────────
@contextmanager
def _db():
    """One connection per operation: commits on success, rolls back on error, always closes."""
    with _DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()


def init_db():
    with _db() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
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
    log.info("SQLite database ready at %s", DB_PATH)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ───────────────────────────────────────────────────────────
#  VALIDATION
# ───────────────────────────────────────────────────────────
def _is_number(value):
    # bool is a subclass of int in Python, so exclude it explicitly.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_setting(key, value):
    kind, allowed = SETTINGS_SCHEMA[key]
    if kind == "number":
        lo, hi = allowed
        if not _is_number(value) or not lo <= value <= hi:
            raise ValidationError(f"{key} must be a number between {lo} and {hi}")
        return int(value) if key == "dwellTimeMs" else value
    if kind == "choice":
        if value not in allowed:
            raise ValidationError(f"{key} must be one of {sorted(allowed)}")
        return value
    if not isinstance(value, bool):
        raise ValidationError(f"{key} must be true or false")
    return value


def validate_settings(patch):
    """Return only the known settings, each checked. Unknown (e.g. retired) keys are ignored."""
    if not isinstance(patch, dict):
        raise ValidationError("settings must be a JSON object")
    return {key: _check_setting(key, value) for key, value in patch.items() if key in SETTINGS_SCHEMA}


def validate_calibration(cal):
    if not isinstance(cal, dict) or cal.get("version") != 3:
        raise ValidationError("calibration must be a version-3 calibration object")
    for axis in ("modelX", "modelY"):
        model = cal.get(axis)
        if not isinstance(model, dict):
            raise ValidationError(f"{axis} is missing")
        for field in ("weights", "mean", "std"):
            values = model.get(field)
            if (not isinstance(values, list) or not values or len(values) > 10000
                    or not all(_is_number(v) for v in values)):
                raise ValidationError(f"{axis}.{field} must be a non-empty list of numbers")
    return cal


def _text_field(data, key, max_len):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{key} is required")
    value = value.strip()
    if len(value) > max_len:
        raise ValidationError(f"{key} must be at most {max_len} characters")
    return value


def _event_timestamp(data):
    """The client's event time (so entries queued while offline keep their real time), else now."""
    raw = data.get("timestamp")
    if raw is None:
        return now_iso()
    if not isinstance(raw, str):
        raise ValidationError("timestamp must be an ISO 8601 string")
    try:
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError("timestamp must be an ISO 8601 string") from None
    if when.tzinfo is None:
        raise ValidationError("timestamp must include a timezone")
    if when > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValidationError("timestamp is in the future")
    return when.astimezone(timezone.utc).isoformat()


# ───────────────────────────────────────────────────────────
#  STORAGE
# ───────────────────────────────────────────────────────────
def get_settings():
    with _db() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key='settings'").fetchone()
    stored = json.loads(row["value"]) if row else {}
    if not isinstance(stored, dict):
        stored = {}
    settings = {}
    for key, default in DEFAULT_SETTINGS.items():
        # A value stored before validation existed may be invalid: use the default instead.
        try:
            settings[key] = _check_setting(key, stored[key]) if key in stored else default
        except ValidationError:
            settings[key] = default
    return settings


def save_settings(patch):
    current = get_settings()
    current.update(validate_settings(patch))
    with _db() as conn:
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('settings', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(current),),
        )
    return current


def get_calibration():
    with _db() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key='calibration'").fetchone()
    return json.loads(row["value"]) if row else None


def save_calibration(cal):
    validate_calibration(cal)
    with _db() as conn:
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('calibration', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(cal),),
        )
    return cal


def _trim(conn, table, limit):
    # `table` is always one of the constant table names above, never user input.
    conn.execute(
        f"DELETE FROM {table} WHERE id NOT IN "
        f"(SELECT id FROM {table} ORDER BY id DESC LIMIT ?)",
        (limit,),
    )


def add_typed(data):
    text = _text_field(data, "text", 1000)
    ts = _event_timestamp(data)
    with _db() as conn:
        conn.execute("INSERT INTO typed_logs (text, timestamp) VALUES (?, ?)", (text, ts))
        _trim(conn, "typed_logs", TYPED_LIMIT)
    return {"text": text, "timestamp": ts}


def add_symptom(data):
    body_part = _text_field(data, "bodyPart", 100)
    symptom = _text_field(data, "symptom", 100)
    ts = _event_timestamp(data)
    with _db() as conn:
        conn.execute(
            "INSERT INTO symptom_logs (body_part, symptom, timestamp) VALUES (?, ?, ?)",
            (body_part, symptom, ts),
        )
        _trim(conn, "symptom_logs", SYMPTOM_LIMIT)
    return {"bodyPart": body_part, "symptom": symptom, "timestamp": ts}


def add_alert(data):
    atype = data.get("type")
    if not isinstance(atype, str) or not ALERT_TYPE_RE.match(atype):
        raise ValidationError("type must be an upper-case identifier such as NURSE_CALL_BUTTON")
    details = data.get("details", "")
    if not isinstance(details, str) or len(details) > 500:
        raise ValidationError("details must be text of at most 500 characters")
    ts = _event_timestamp(data)
    with _db() as conn:
        conn.execute(
            "INSERT INTO alert_logs (type, details, timestamp) VALUES (?, ?, ?)",
            (atype, details, ts),
        )
        _trim(conn, "alert_logs", ALERT_LIMIT)
    # No remote notification exists: alerts are stored locally only.
    log.info("alert stored: %s", atype)   # type only — details may contain health data
    return {"type": atype, "details": details, "timestamp": ts}


def get_logs():
    with _db() as conn:
        typed = [
            {"id": f"log_{r['id']}", "text": r["text"], "timestamp": r["timestamp"]}
            for r in conn.execute("SELECT * FROM typed_logs ORDER BY id DESC").fetchall()
        ]
        symptom = [
            {
                "id": f"sym_{r['id']}",
                "bodyPart": r["body_part"],
                "symptom": r["symptom"],
                "timestamp": r["timestamp"],
            }
            for r in conn.execute("SELECT * FROM symptom_logs ORDER BY id DESC").fetchall()
        ]
        alert = [
            {
                "id": f"alert_{r['id']}",
                "type": r["type"],
                "details": r["details"],
                "timestamp": r["timestamp"],
            }
            for r in conn.execute("SELECT * FROM alert_logs ORDER BY id DESC").fetchall()
        ]
    return {"typed": typed, "symptom": symptom, "alert": alert}


def clear_logs():
    with _db() as conn:
        conn.execute("DELETE FROM typed_logs")
        conn.execute("DELETE FROM symptom_logs")
        conn.execute("DELETE FROM alert_logs")
    return {"cleared": True}


# ───────────────────────────────────────────────────────────
#  HTTP HANDLER
# ───────────────────────────────────────────────────────────
def _is_loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_public_path(url_path):
    """True only for files the browser app needs (see STATIC_FILES / STATIC_DIRS)."""
    path = posixpath.normpath(unquote(url_path))
    if any(part.startswith(".") for part in path.split("/") if part):
        return False                      # dotfiles, and anything that tried to use ".."
    if path in STATIC_FILES:
        return True
    for prefix, extensions in STATIC_DIRS.items():
        if path.startswith(prefix):
            name = posixpath.basename(path)
            return posixpath.splitext(name)[1] in extensions and not name.startswith(("_", "test_"))
    return False


class LumiIQHandler(SimpleHTTPRequestHandler):
    server_version = "LumiIQ/2.1"
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }

    # ---- helpers --------------------------------------------------
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _host_allowed(self):
        """On a loopback server, only accept requests addressed to localhost (anti DNS rebinding)."""
        if not _is_loopback(self.server.server_address[0]):
            return True   # the operator chose to expose the server; see the warning in main()
        host = (self.headers.get("Host") or "").strip().lower()
        name = host.split("]")[0] + "]" if host.startswith("[") else host.rsplit(":", 1)[0]
        return name in {"localhost", "127.0.0.1", "[::1]"}

    def _read_json(self):
        """Parse a JSON request body, or raise _HttpError."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            raise _HttpError(400, "invalid Content-Length") from None
        if length > MAX_BODY_BYTES:
            self._discard_body(length)
            raise _HttpError(413, "request body too large")
        # Read the body before any other check: closing a connection with unread
        # data makes the client see a reset instead of our error response.
        raw = self.rfile.read(length) if length > 0 else b""
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            raise _HttpError(415, "Content-Type must be application/json")
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise _HttpError(400, "body is not valid JSON") from None

    def _discard_body(self, length):
        """Drop an oversized body (reading at most 1 MB) so the client receives the 413."""
        remaining = min(length, 4 * MAX_BODY_BYTES)
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

    @staticmethod
    def _path(raw_path):
        return urlsplit(raw_path).path

    # ---- verbs ----------------------------------------------------
    def do_GET(self):  # noqa: N802
        if not self._host_allowed():
            return self._send_json({"error": "Host not allowed"}, 403)
        path = self._path(self.path)
        if path.startswith("/api/"):
            return self._api("GET", path)
        if not is_public_path(path):
            return self.send_error(404, "Not found")
        return super().do_GET()

    def do_HEAD(self):  # noqa: N802
        if not self._host_allowed():
            return self.send_error(403, "Host not allowed")
        if not is_public_path(self._path(self.path)):
            return self.send_error(404, "Not found")
        return super().do_HEAD()

    def do_POST(self):  # noqa: N802
        self._write("POST")

    def do_PUT(self):  # noqa: N802
        self._write("PUT")

    def do_DELETE(self):  # noqa: N802
        self._write("DELETE")

    def list_directory(self, path):
        self.send_error(404, "Not found")   # never list folders
        return None

    def _write(self, method):
        if not self._host_allowed():
            return self._send_json({"error": "Host not allowed"}, 403)
        path = self._path(self.path)
        if not path.startswith("/api/"):
            return self._send_json({"error": "Not found"}, 404)
        return self._api(method, path)

    # ---- API routing ----------------------------------------------
    def _api(self, method, path):
        try:
            data = self._read_json() if method in ("POST", "PUT") else None
            if method == "POST" and not isinstance(data, dict):
                raise ValidationError("body must be a JSON object")
            route = ROUTES.get((method, path))
            if route is None:
                return self._send_json({"error": "Unknown endpoint"}, 404)
            status, payload = route(data)
            return self._send_json(payload, status)
        except _HttpError as exc:
            return self._send_json({"error": exc.message}, exc.status)
        except ValidationError as exc:
            return self._send_json({"error": str(exc)}, 400)
        except Exception:  # never crash the server; the details go to the log, not the client
            log.exception("error handling %s %s", method, path)
            return self._send_json({"error": "internal error"}, 500)

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)


class _HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


ROUTES = {
    ("GET", "/api/health"):      lambda _: (200, {"status": "ok", "time": now_iso()}),
    ("GET", "/api/settings"):    lambda _: (200, get_settings()),
    ("PUT", "/api/settings"):    lambda d: (200, save_settings(d)),
    ("GET", "/api/calibration"): lambda _: (200, get_calibration()),
    ("PUT", "/api/calibration"): lambda d: (200, save_calibration(d)),
    ("GET", "/api/logs"):        lambda _: (200, get_logs()),
    ("POST", "/api/logs/typed"):   lambda d: (201, add_typed(d)),
    ("POST", "/api/logs/symptom"): lambda d: (201, add_symptom(d)),
    ("POST", "/api/logs/alert"):   lambda d: (201, add_alert(d)),
    ("DELETE", "/api/logs"):     lambda _: (200, clear_logs()),
}


# ───────────────────────────────────────────────────────────
#  ENTRY POINT
# ───────────────────────────────────────────────────────────
def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="LumiIQ local server")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface to listen on (default 127.0.0.1: this computer only)")
    parser.add_argument("--db", default=None,
                        help="SQLite file (default: $LUMIIQ_DB, else lumiiq.db next to server.py)")
    return parser.parse_args(argv)


def main(argv=None):
    global DB_PATH
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="[LumiIQ] %(levelname)s %(message)s")
    if args.db:
        DB_PATH = args.db
    init_db()
    if not _is_loopback(args.host):
        log.warning("Listening on %s: other devices on the network can reach this server, "
                    "which has NO login and stores health data.", args.host)
    handler = partial(LumiIQHandler, directory=BASE_DIR)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    log.info("Server running:  http://localhost:%d", args.port)
    log.info("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down…")
        httpd.server_close()


if __name__ == "__main__":
    main()
