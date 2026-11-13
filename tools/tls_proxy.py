"""TLS-impersonating HTTP proxy.

Node's built-in fetch is blocked by Cloudflare on several of the hosts this
repository scrapes, because its TLS fingerprint is not a browser's. This proxy
accepts a request over plain HTTP on localhost and replays it with curl_cffi
using Chrome's TLS profile, then returns the response.

Request:  POST /fetch  { url, method, headers, body, timeout }
Response: 200 { status, headers, body(base64), error? }
"""

from __future__ import annotations

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from curl_cffi import requests as curl_requests
except ImportError:  # pragma: no cover - surfaced at call time
    curl_requests = None


class _Log:
    """Records every tunnelled request so the watcher can explain failures."""

    def __init__(self) -> None:
        self._entries: list[dict] = []
        self._lock = threading.Lock()

    def add(self, entry: dict) -> None:
        with self._lock:
            self._entries.append(entry)

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self._entries)

    def reset(self) -> None:
        with self._lock:
            self._entries.clear()


LOG = _Log()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):  # keep the output clean
        return

    def do_POST(self):  # noqa: N802 - http.server API
        if self.path.startswith("/log/reset"):
            LOG.reset()
            self._reply({"ok": True})
            return
        if not self.path.startswith("/fetch"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._reply({"status": 0, "headers": {}, "body": "", "error": "bad request"})
            return

        self._reply(self.perform(payload))

    def do_GET(self):  # noqa: N802 - http.server API
        if self.path.startswith("/log"):
            data = json.dumps({"entries": LOG.snapshot()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _reply(self, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def perform(self, payload: dict) -> dict:
        url = payload.get("url") or ""
        method = (payload.get("method") or "GET").upper()
        headers = payload.get("headers") or {}
        body = payload.get("body")
        timeout = payload.get("timeout") or 25

        if not url:
            return {"status": 0, "headers": {}, "body": "", "error": "missing url"}
        if curl_requests is None:
            return {
                "status": 0,
                "headers": {},
                "body": "",
                "error": "curl_cffi is not installed (pip install -r tools/requirements.txt)",
            }

        # Node sends header names in lower case; curl is happy with that.
        clean_headers = {str(k): str(v) for k, v in headers.items() if k.lower() != "host"}
        # The impersonation profile already carries a browser User-Agent, but
        # an explicit one from the provider is preferred when present.
        if not any(k.lower() == "user-agent" for k in clean_headers):
            clean_headers["User-Agent"] = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
            )

        try:
            response = curl_requests.request(
                method,
                url,
                headers=clean_headers,
                data=body.encode("utf-8") if isinstance(body, str) else body,
                impersonate="chrome",
                timeout=timeout,
                allow_redirects=True,
            )
        except Exception as exc:  # network level failure
            LOG.add({"url": url, "method": method, "status": 0, "error": f"{type(exc).__name__}: {exc}"[:200]})
            return {
                "status": 0,
                "headers": {},
                "body": "",
                "error": f"{type(exc).__name__}: {exc}"[:300],
            }

        LOG.add({
            "url": url,
            "method": method,
            "status": response.status_code,
            "length": len(response.content or b""),
            "final": str(response.url),
        })
        return {
            "status": response.status_code,
            "headers": dict(response.headers),
            "body": base64.b64encode(response.content or b"").decode("ascii"),
        }


class TlsProxy:
    """Runs the proxy on a background thread and exposes its port."""

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self._server = ThreadingHTTPServer((host, port), _Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def __enter__(self) -> "TlsProxy":
        self._thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        self._server.shutdown()
        self._server.server_close()
