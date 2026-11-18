"""Offline tests for mirror selection, downloads and deployment targets."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import deploy, net  # noqa: E402
from lib.manifest import Mirrors  # noqa: E402

GITHUB = "https://github.com/zsh-users/zsh-syntax-highlighting.git"


def make_zip(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr("MapleMono-NF-CN-Regular.ttf", b"font")


class MirrorTests(unittest.TestCase):
    def test_proxies_keep_the_direct_url_as_a_fallback(self) -> None:
        mirrors = Mirrors(github_proxies=["https://ghfast.top/", "https://gh-proxy.com/"])
        urls = mirrors.github_urls(GITHUB)
        self.assertEqual(urls[0], f"https://ghfast.top/{GITHUB}")
        self.assertEqual(urls[1], f"https://gh-proxy.com/{GITHUB}")
        self.assertEqual(urls[-1], GITHUB, "the unproxied URL must stay reachable")

    def test_primary_mirror_is_the_first_url(self) -> None:
        mirrors = Mirrors(github_proxies=["https://ghfast.top/"])
        self.assertEqual(mirrors.github(GITHUB), f"https://ghfast.top/{GITHUB}")

    def test_non_github_urls_are_left_alone(self) -> None:
        mirrors = Mirrors(github_proxies=["https://ghfast.top/"])
        url = "https://registry.npmmirror.com/-/binary/node/"
        self.assertEqual(mirrors.github_urls(url), [url])


class DownloadTests(unittest.TestCase):
    def test_invalid_content_falls_through_to_the_next_mirror(self) -> None:
        mirrors = Mirrors(github_proxies=["https://ghfast.top/"])
        attempts: list[str] = []

        def fake_download(url: str, dest: Path) -> None:
            attempts.append(url)
            if len(attempts) == 1:
                dest.write_bytes(b"<html>403 Forbidden</html>")
            else:
                make_zip(dest)

        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "font.zip"
            with mock.patch.object(net, "_download_one", fake_download):
                net.download(
                    mirrors.github_urls("https://github.com/x/y/releases/download/v1/y.zip"),
                    archive,
                    mirrors,
                    validate=zipfile.is_zipfile,
                )
            self.assertEqual(len(attempts), 2)
            self.assertTrue(zipfile.is_zipfile(archive))
            self.assertTrue(attempts[0].startswith("https://ghfast.top/"))
            self.assertTrue(attempts[1].startswith("https://github.com/"))

    def test_every_mirror_failing_raises(self) -> None:
        mirrors = Mirrors(github_proxies=["https://ghfast.top/"])
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "font.zip"
            with mock.patch.object(
                net, "_download_one", lambda url, dest: dest.write_bytes(b"nope")
            ):
                with self.assertRaises(ValueError):
                    net.download(
                        mirrors.github_urls("https://github.com/x/y.zip"),
                        archive,
                        mirrors,
                        validate=zipfile.is_zipfile,
                    )


class DeployTargetTests(unittest.TestCase):
    def _source(self, root: Path) -> Path:
        source = root / "fastfetch"
        source.mkdir()
        (source / "config.jsonc").write_text("{}", encoding="utf-8")
        return source

    def test_missing_parent_directories_are_created(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dest = root / "home" / ".config" / "fastfetch"
            deploy.copy_item(self._source(root), dest, root / "backup")
            self.assertTrue((dest / "config.jsonc").is_file())

    def test_a_file_blocking_the_parent_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".config").write_text("not a directory", encoding="utf-8")
            dest = root / ".config" / "fastfetch"
            with self.assertRaises(RuntimeError) as raised:
                deploy.copy_item(self._source(root), dest, root / "backup")
            self.assertIn("not a directory", str(raised.exception))

    def test_a_dangling_parent_link_is_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            link = root / ".config"
            try:
                link.symlink_to(root / "gone")
            except (OSError, NotImplementedError):
                self.skipTest("symlinks are not available for this user")
            dest = link / "fastfetch"
            deploy.copy_item(self._source(root), dest, root / "backup")
            self.assertFalse(link.is_symlink())
            self.assertTrue((dest / "config.jsonc").is_file())


if __name__ == "__main__":
    unittest.main()
