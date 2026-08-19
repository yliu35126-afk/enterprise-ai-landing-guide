import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.client import LandingGuideApi, LandingGuideApiError


class Handler(BaseHTTPRequestHandler):
    last_request = {}

    def log_message(self, *_args):
        return

    def do_GET(self):
        if self.path.endswith("/health"):
            self.reply(200, {"status": "ok"})
        else:
            self.reply(404, {"code": "EXT-40400", "message": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        body = json.loads(raw.decode("utf-8")) if self.headers.get("Content-Type") == "application/json" else {}
        Handler.last_request = {"path": self.path, "body": body, "authorization": self.headers.get("Authorization")}
        self.reply(201, {"sessionId": "session-1", "sessionToken": "elag_test"})

    def reply(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class LandingGuideClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.client = LandingGuideApi(f"http://127.0.0.1:{cls.server.server_port}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_health(self):
        self.assertEqual(self.client.health(), {"status": "ok"})

    def test_create_forces_dify_attribution(self):
        self.client.create("dify-conversation-1", "KNOWN_PROBLEM", "DIFY_TEST")
        self.assertEqual(Handler.last_request["body"]["sourcePlatform"], "DIFY")
        self.assertEqual(Handler.last_request["body"]["sourceVersion"], "1.2.0")
        self.assertIsNone(Handler.last_request["authorization"])

    def test_error_is_readable_without_internal_stack(self):
        with self.assertRaises(LandingGuideApiError) as raised:
            self.client.request("GET", "/missing")
        self.assertNotIn("Traceback", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
