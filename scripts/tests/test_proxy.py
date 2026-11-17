"""Proxy URL normalisation (host:port with an auto-detected scheme)."""

from __future__ import annotations

import socket
import sys
import threading
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import proxy  # noqa: E402


def _serve(reply: bytes) -> tuple[int, threading.Thread]:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]

    def run() -> None:
        try:
            conn, _ = server.accept()
        except OSError:
            return
        with conn:
            conn.recv(3)
            conn.sendall(reply)
        server.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return port, thread


class NormalizeProxyTests(unittest.TestCase):
    def test_empty_and_none(self) -> None:
        self.assertEqual(proxy.normalize_proxy(""), "")
        self.assertEqual(proxy.normalize_proxy("none"), "")

    def test_explicit_scheme_is_kept(self) -> None:
        self.assertEqual(proxy.normalize_proxy("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080")
        self.assertEqual(proxy.normalize_proxy("http://127.0.0.1:7890"), "http://127.0.0.1:7890")

    def test_socks5_is_detected(self) -> None:
        port, thread = _serve(b"\x05\x00")
        try:
            self.assertEqual(
                proxy.normalize_proxy(f"127.0.0.1:{port}"), f"socks5://127.0.0.1:{port}"
            )
        finally:
            thread.join(timeout=2)

    def test_other_services_fall_back_to_http(self) -> None:
        port, thread = _serve(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        try:
            self.assertEqual(
                proxy.normalize_proxy(f"127.0.0.1:{port}"), f"http://127.0.0.1:{port}"
            )
        finally:
            thread.join(timeout=2)

    def test_invalid_value(self) -> None:
        with self.assertRaises(ValueError):
            proxy.normalize_proxy("127.0.0.1")


if __name__ == "__main__":
    unittest.main()
