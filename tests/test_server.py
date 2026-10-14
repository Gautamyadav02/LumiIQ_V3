"""Integration tests for server.py (standard library only).

Each test class starts the real server on 127.0.0.1 with a temporary
database, so the real lumiiq.db is never touched.
Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402


class ServerCase(unittest.TestCase):
    """Starts one server with its own empty database per test class."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        server.DB_PATH = os.path.join(cls._tmp.name, "test.db")
        server.init_db()
        handler = partial(server.LumiIQHandler, directory=server.BASE_DIR)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmp.cleanup()

    def request(self, method, path, body=None, headers=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = {"Host": host or f"localhost:{self.port}"}
        data = None
        if body is not None:
            data = body if isinstance(body, (bytes, str)) else json.dumps(body)
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        headers_out = {k.lower(): v for k, v in resp.getheaders()}
        conn.close()
        return resp.status, headers_out, payload

    def json_request(self, method, path, body=None, **kw):
        status, headers, payload = self.request(method, path, body, **kw)
        return status, (json.loads(payload) if payload else None)


class DefaultsTests(unittest.TestCase):
    def test_listens_on_this_computer_only_by_default(self):
        self.assertEqual(server.parse_args([]).host, "127.0.0.1")

    def test_port_can_still_be_given_positionally(self):
        self.assertEqual(server.parse_args(["9000"]).port, 9000)


class StaticFileTests(ServerCase):
    def test_serves_the_app_files(self):
        for path in ["/", "/index.html", "/app.js", "/diagnostics.js", "/gaze/dwell-controller.js",
                     "/lib/mediapipe/vision_bundle.mjs", "/models/face_landmarker.task", "/icons/icon-192.png"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)

    def test_does_not_serve_private_files(self):
        for path in ["/server.py", "/AUDIT.md", "/.gitignore", "/.git/config", "/lumiiq.db",
                     "/eyecare.db", "/archive/platform/.env", "/gaze/test_gaze.js", "/gaze/_smoke.js",
                     "/gaze/../server.py", "/gaze/%2e%2e/server.py", "/validate.py", "/package.json"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_app_files_are_revalidated_so_a_code_change_is_never_run_stale(self):
        # Without Cache-Control, Chrome guessed the files were still fresh and kept running old
        # JavaScript after a change, even on reload. "no-cache" asks first; unchanged files are a 304.
        for path in ["/", "/app.js", "/voice.js", "/gaze-engine.js"]:
            with self.subTest(path=path):
                status, headers, _ = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(headers.get("cache-control"), "no-cache")
                again = self.request("GET", path, headers={"If-Modified-Since": headers["last-modified"]})
                self.assertEqual(again[0], 304)

    def test_api_answers_are_still_never_stored(self):
        self.assertEqual(self.request("GET", "/api/logs")[1].get("cache-control"), "no-store")

    def test_never_lists_folders(self):
        for path in ["/gaze/", "/lib/", "/archive/", "/tests/"]:
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"Directory listing", body)


class RequestSecurityTests(ServerCase):
    def test_no_cors_headers_so_other_sites_cannot_read_the_api(self):
        _, headers, _ = self.request("GET", "/api/logs")
        self.assertNotIn("access-control-allow-origin", headers)

    def test_cors_preflight_is_not_granted(self):
        status, headers, _ = self.request("OPTIONS", "/api/logs",
                                          headers={"Origin": "https://evil.example",
                                                   "Access-Control-Request-Method": "DELETE"})
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertGreaterEqual(status, 400)

    def test_rejects_requests_addressed_to_another_host(self):
        # A DNS-rebinding page would send its own domain as Host.
        self.assertEqual(self.request("GET", "/api/logs", host="evil.example")[0], 403)
        self.assertEqual(self.request("GET", "/index.html", host="evil.example:8000")[0], 403)
        self.assertEqual(self.request("GET", "/api/health", host="127.0.0.1")[0], 200)

    def test_writes_must_be_json(self):
        # text/plain is what a cross-site form or no-preflight fetch would send.
        status, _, _ = self.request("POST", "/api/logs/typed", '{"text": "hi"}',
                                    headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_rejects_oversized_bodies(self):
        status, _ = self.json_request("POST", "/api/logs/typed", {"text": "big" + "x" * (300 * 1024)})
        self.assertEqual(status, 413)
        self.assertEqual(self.request("GET", "/api/health")[0], 200, "server still healthy")
        _, logs = self.json_request("GET", "/api/logs")
        self.assertFalse(any(t["text"].startswith("big") for t in logs["typed"]), "nothing stored")

    def test_rejects_invalid_json(self):
        self.assertEqual(self.request("POST", "/api/logs/typed", "{not json")[0], 400)

    def test_rejects_non_object_bodies(self):
        self.assertEqual(self.json_request("POST", "/api/logs/typed", [1, 2])[0], 400)


class LogTests(ServerCase):
    def test_typed_log_round_trip(self):
        self.assertEqual(self.json_request("POST", "/api/logs/typed", {"text": "hello nurse"})[0], 201)
        _, logs = self.json_request("GET", "/api/logs")
        self.assertIn("hello nurse", [t["text"] for t in logs["typed"]])

    def test_text_is_stored_verbatim_and_length_limited(self):
        payload = "<img src=x onerror=alert(1)>"
        self.assertEqual(self.json_request("POST", "/api/logs/typed", {"text": payload})[0], 201)
        self.assertEqual(self.json_request("POST", "/api/logs/typed", {"text": "x" * 1001})[0], 400)

    def test_alert_type_must_be_an_identifier(self):
        self.assertEqual(self.json_request("POST", "/api/logs/alert", {"type": "bad type!"})[0], 400)
        self.assertEqual(self.json_request("POST", "/api/logs/alert",
                                           {"type": "NURSE_CALL_BUTTON", "details": "x"})[0], 201)

    def test_client_event_time_is_kept(self):
        status, entry = self.json_request("POST", "/api/logs/symptom",
                                          {"bodyPart": "Chest", "symptom": "pain",
                                           "timestamp": "2026-01-02T03:04:05.000Z"})
        self.assertEqual(status, 201)
        self.assertEqual(entry["timestamp"], "2026-01-02T03:04:05+00:00")

    def test_future_or_malformed_event_times_are_rejected(self):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        for ts in [future, "yesterday", "2026-01-02T03:04:05"]:
            with self.subTest(ts=ts):
                self.assertEqual(self.json_request("POST", "/api/logs/typed",
                                                   {"text": "t", "timestamp": ts})[0], 400)

    def test_delete_clears_logs(self):
        self.json_request("POST", "/api/logs/typed", {"text": "to be cleared"})
        self.assertEqual(self.json_request("DELETE", "/api/logs")[0], 200)
        _, logs = self.json_request("GET", "/api/logs")
        self.assertEqual(logs, {"typed": [], "symptom": [], "alert": []})


class SettingsTests(ServerCase):
    def test_valid_settings_are_saved(self):
        status, saved = self.json_request("PUT", "/api/settings", {"dwellTimeMs": 1500, "alarmVolume": 0.4})
        self.assertEqual(status, 200)
        _, settings = self.json_request("GET", "/api/settings")
        self.assertEqual((settings["dwellTimeMs"], settings["alarmVolume"]), (1500, 0.4))

    def test_invalid_values_are_rejected(self):
        for patch in [{"alarmVolume": "loud"}, {"dwellTimeMs": 99999}, {"earThreshold": True},
                      {"activeEye": "third"}, {"swapEyes": "false"}, {"voiceRate": float("nan")}]:
            with self.subTest(patch=patch):
                body = json.dumps(patch)   # json.dumps writes NaN, which Python's json accepts back
                self.assertEqual(self.request("PUT", "/api/settings", body)[0], 400)

    def test_selection_settings_are_validated(self):
        ok = {"selectionMode": "blink", "blinkSelectMs": 600, "dwellRepeat": True}
        self.assertEqual(self.json_request("PUT", "/api/settings", ok)[0], 200)
        _, settings = self.json_request("GET", "/api/settings")
        self.assertEqual({k: settings[k] for k in ok}, ok)
        for bad in [{"selectionMode": "wink"}, {"blinkSelectMs": 5000}, {"dwellRepeat": "yes"}]:
            with self.subTest(bad=bad):
                self.assertEqual(self.json_request("PUT", "/api/settings", bad)[0], 400)

    def test_sleep_settings_are_validated(self):
        self.assertEqual(self.json_request("PUT", "/api/settings", {"sleepWakeSec": 10, "sleepModeUntil": 0})[0], 200)
        for bad in [{"sleepWakeSec": 0}, {"sleepModeUntil": -1}, {"sleepModeUntil": "tonight"}]:
            with self.subTest(bad=bad):
                self.assertEqual(self.json_request("PUT", "/api/settings", bad)[0], 400)

    def test_unknown_keys_are_ignored(self):
        self.json_request("PUT", "/api/settings", {"gazeSensitivityX": 2, "evil": "<script>"})
        _, settings = self.json_request("GET", "/api/settings")
        self.assertNotIn("gazeSensitivityX", settings)
        self.assertNotIn("evil", settings)

    def test_invalid_values_already_in_the_database_fall_back_to_defaults(self):
        with sqlite3.connect(server.DB_PATH) as conn:
            conn.execute("UPDATE kv SET value=? WHERE key='settings'",
                         (json.dumps({"dwellTimeMs": "abc", "alarmVolume": 0.3}),))
        _, settings = self.json_request("GET", "/api/settings")
        self.assertEqual(settings["dwellTimeMs"], server.DEFAULT_SETTINGS["dwellTimeMs"])
        self.assertEqual(settings["alarmVolume"], 0.3)


class CalibrationTests(ServerCase):
    VALID = {"version": 3, "featureDim": 10, "degree": 2,
             "modelX": {"weights": [0.1, 0.2], "mean": [0.0], "std": [1.0]},
             "modelY": {"weights": [0.3, 0.4], "mean": [0.0], "std": [1.0]}}

    def test_valid_calibration_round_trip(self):
        self.assertEqual(self.json_request("PUT", "/api/calibration", self.VALID)[0], 200)
        self.assertEqual(self.json_request("GET", "/api/calibration")[1], self.VALID)

    def test_malformed_calibration_is_rejected(self):
        broken = json.loads(json.dumps(self.VALID))
        broken["modelY"]["weights"] = ["x"]
        for body in [{"version": 2}, broken, [1, 2, 3]]:
            with self.subTest(body=body):
                self.assertEqual(self.json_request("PUT", "/api/calibration", body)[0], 400)

    def test_head_frame_calibration_version_4_is_accepted(self):
        # Phase C (C1): a calibration of the head-frame features is version 4.
        head = dict(self.VALID, version=4, featureSet="head")
        self.assertEqual(self.json_request("PUT", "/api/calibration", head)[0], 200)
        self.assertEqual(self.json_request("GET", "/api/calibration")[1], head)
        image = dict(self.VALID, featureSet="image")
        self.assertEqual(self.json_request("PUT", "/api/calibration", image)[0], 200)

    def test_version_and_feature_set_must_agree(self):
        for body in [dict(self.VALID, version=4), dict(self.VALID, version=4, featureSet="image"),
                     dict(self.VALID, featureSet="head"), dict(self.VALID, featureSet="other"),
                     dict(self.VALID, version=5, featureSet="head")]:
            with self.subTest(body={k: body.get(k) for k in ("version", "featureSet")}):
                self.assertEqual(self.json_request("PUT", "/api/calibration", body)[0], 400)


def eval_session(**changes):
    """A minimal valid evaluation session (format v2, as eval/session-recorder.js writes it)."""
    session = {
        "format": "lumiiq-eval-session", "version": 2, "id": "2026-10-14T09-00-00Z-ab12",
        "createdAt": "2026-10-14T09:00:00.000Z", "finishedAt": "2026-10-14T09:10:00.000Z",
        "consent": {"given": True, "at": "2026-10-14T09:00:00.000Z"},
        "setup": {"distanceCm": 60, "screenWidthCm": 30.5, "lighting": "daylight", "note": ""},
        "screen": {"width": 1440, "height": 900, "dpr": 2},
        "frameFields": ["t", "face", "f0"],
        "frames": [[33.3, 1, 0.5], [66.6, 0, None]],
        "landmarks": [[0.4, 0.45, -0.01], None],
        "matrices": [[1, 0, 0, 0], None],
        "phases": [], "targets": [], "calibrations": [], "layouts": {}, "selections": [],
        "rest": None, "events": [], "summary": None,
    }
    session.update(changes)
    return session


class EvalSessionTests(ServerCase):
    """POST /api/eval/session: the evaluation wizard saves a session into eval/sessions/."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._sessions = tempfile.TemporaryDirectory()
        cls._old_dir, cls._old_limit = server.SESSIONS_DIR, server.MAX_SESSION_BYTES
        server.SESSIONS_DIR = cls._sessions.name

    @classmethod
    def tearDownClass(cls):
        server.SESSIONS_DIR, server.MAX_SESSION_BYTES = cls._old_dir, cls._old_limit
        cls._sessions.cleanup()
        super().tearDownClass()

    def setUp(self):
        server.MAX_SESSION_BYTES = self._old_limit
        for name in os.listdir(self._sessions.name):
            os.remove(os.path.join(self._sessions.name, name))

    def saved(self):
        return sorted(os.listdir(self._sessions.name))

    def test_a_valid_session_is_written_as_id_json(self):
        session = eval_session()
        status, reply = self.json_request("POST", "/api/eval/session", session)
        self.assertEqual(status, 201)
        self.assertEqual(reply["file"], "eval/sessions/2026-10-14T09-00-00Z-ab12.json")
        self.assertEqual(self.saved(), ["2026-10-14T09-00-00Z-ab12.json"])
        with open(os.path.join(self._sessions.name, self.saved()[0]), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), session)

    def test_a_session_without_consent_is_refused(self):
        for consent in [{"given": False}, {}, None, {"given": "yes"}]:
            with self.subTest(consent=consent):
                status, reply = self.json_request("POST", "/api/eval/session", eval_session(consent=consent))
                self.assertEqual(status, 400)
                self.assertIn("consent", reply["error"])
        self.assertEqual(self.saved(), [])

    def test_the_id_cannot_be_used_to_write_elsewhere(self):
        for bad in ["../../evil", "a/b", "..", "", "x" * 80, "has space", None, 7]:
            with self.subTest(id=bad):
                self.assertEqual(self.json_request("POST", "/api/eval/session", eval_session(id=bad))[0], 400)
        self.assertEqual(self.saved(), [])

    def test_other_formats_and_non_numeric_frames_are_refused(self):
        for bad in [{"format": "other"}, {"version": 1}, {"frames": [["x", 1, 2]]}, {"frames": "none"},
                    {"frames": [[1, 2]]}, {"landmarks": [["a"]]}, {"matrices": [{"x": 1}]}]:
            with self.subTest(bad=bad):
                self.assertEqual(self.json_request("POST", "/api/eval/session", eval_session(**bad))[0], 400)
        self.assertEqual(self.saved(), [])

    def test_long_or_image_like_text_is_refused(self):
        for bad in [{"setup": {"note": "data:image/png;base64,AAAA"}},
                    {"events": [{"t": 1, "name": "n", "data": {"blob": "z" * 400}}]},
                    {"summary": {"video": "x;base64,QUJD"}}]:
            with self.subTest(bad=list(bad)):
                status, reply = self.json_request("POST", "/api/eval/session", eval_session(**bad))
                self.assertEqual(status, 400)
                self.assertIn("text", reply["error"])
        self.assertEqual(self.saved(), [])

    def test_a_saved_session_is_never_overwritten(self):
        self.assertEqual(self.json_request("POST", "/api/eval/session", eval_session())[0], 201)
        status, reply = self.json_request("POST", "/api/eval/session", eval_session(setup={"note": "second"}))
        self.assertEqual(status, 409)
        with open(os.path.join(self._sessions.name, self.saved()[0]), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["setup"]["note"], "")

    def test_it_has_its_own_size_limit_larger_than_the_other_endpoints(self):
        big = eval_session(frames=[[float(i), 1, 0.5] for i in range(40000)])     # about 600 KB
        self.assertGreater(len(json.dumps(big)), server.MAX_BODY_BYTES)
        self.assertEqual(self.json_request("POST", "/api/eval/session", big)[0], 201)
        # The ordinary endpoints keep their 256 KB limit.
        self.assertEqual(self.json_request("POST", "/api/logs/typed", {"text": "x" * 300000})[0], 413)

    def test_a_session_over_its_own_limit_is_refused(self):
        server.MAX_SESSION_BYTES = 200 * 1024
        big = eval_session(frames=[[float(i), 1, 0.5] for i in range(40000)])
        self.assertEqual(self.json_request("POST", "/api/eval/session", big)[0], 413)
        self.assertEqual(self.saved(), [])
        self.assertEqual(self.request("GET", "/api/health")[0], 200, "server still healthy")

    def test_saved_sessions_are_never_served(self):
        self.assertEqual(self.json_request("POST", "/api/eval/session", eval_session())[0], 201)
        for path in ["/eval/sessions/2026-10-14T09-00-00Z-ab12.json", "/eval/sessions/", "/api/eval/session",
                     "/api/eval/sessions"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_it_must_be_json_and_addressed_to_this_computer(self):
        body = json.dumps(eval_session())
        self.assertEqual(self.request("POST", "/api/eval/session", body, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/eval/session", body, host="evil.example")[0], 403)
        self.assertEqual(self.saved(), [])


class EvalStaticFileTests(ServerCase):
    def test_only_the_browser_side_evaluation_scripts_are_served(self):
        for path in ["/eval/metrics.js", "/eval/session-recorder.js", "/eval/eval-wizard.js"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)
        for path in ["/eval/replay.js", "/eval/report.js", "/eval/BASELINE.md", "/eval/synthetic/ear-threshold.js",
                     "/eval/", "/eval/sessions/"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)


if __name__ == "__main__":
    unittest.main()
