#!/usr/bin/env python3
"""Local http server for Crypto Space 77 (mirrors .htaccess)."""

import argparse
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFIX = ""  # e.g. "/dir" when the app is served from a subdirectory


def strip_prefix(raw_path):
    path = raw_path or "/"
    if not PREFIX:
        return path
    if path == PREFIX or path == PREFIX + "/":
        return "/"
    if path.startswith(PREFIX + "/"):
        return path[len(PREFIX) :] or "/"
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw = urllib.parse.unquote(parsed.path)
        stripped = strip_prefix(raw)
        if stripped is None:
            self.send_error(404)
            return
        rel = stripped.lstrip("/")
        qs = parsed.query
        if rel:
            target = (ROOT / rel).resolve()
            try:
                target.relative_to(ROOT)
            except ValueError:
                self.send_error(403)
                return
            if target.is_file():
                self.path = "/" + rel + (("?" + qs) if qs else "")
                return super().do_GET()
        self.path = "/index.html" + (("?" + qs) if qs else "")
        return super().do_GET()

    def log_message(self, fmt, *args):
        try:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
            sys.stderr.flush()
        except OSError:
            pass


class Server(ThreadingHTTPServer):
    allow_reuse_address = False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crypto Space 77 local server")
    parser.add_argument("--port", type=int, default=8777)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--prefix",
        default="/",
        help="URL prefix when serving from a subdirectory, e.g. /dir",
    )
    args = parser.parse_args()
    prefix = (args.prefix or "/").strip() or "/"
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    PREFIX = "" if prefix == "/" else prefix.rstrip("/")
    try:
        httpd = Server((args.host, args.port), Handler)
    except OSError as exc:
        print(f"Could not bind http://{args.host}:{args.port}/ — {exc}", file=sys.stderr)
        print("Stop the old python process using that port, or pick another: python server.py --port 8778", file=sys.stderr)
        sys.exit(1)
    root_url = f"http://{args.host}:{args.port}{PREFIX}/"
    print(f"Crypto Space 77  {root_url}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
        httpd.server_close()
