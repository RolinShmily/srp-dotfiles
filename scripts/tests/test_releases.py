"""Offline tests for GitHub Release package installers."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import catalog, installers  # noqa: E402
from lib.manifest import Manifest, Mirrors, ReleaseEntry  # noqa: E402

SAMPLE_LINUX_YML = """version: 0.18.1
files:
  - url: Paseo-x86_64.AppImage
    sha512: AAAA==
  - url: Paseo-0.18.1-amd64.deb
    sha512: BBBB==
  - url: Paseo-0.18.1-x86_64.rpm
    sha512: {sha512}
    size: 117046493
path: Paseo-x86_64.AppImage
sha512: AAAA==
releaseDate: '2026-11-27T18:06:04.000Z'
"""


class ReleaseManifestAndCatalogTests(unittest.TestCase):
    def test_manifest_and_catalog_support_github_releases_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            manifest_dir = repo / "manifest"
            manifest_dir.mkdir()
            (manifest_dir / "fedora.json").write_text(
                json.dumps(
                    {
                        "packageManager": "dnf",
                        "packages": [],
                        "githubReleases": [
                            {
                                "name": "paseo",
                                "repo": "getpaseo/paseo",
                                "asset": "Paseo-*-x86_64.rpm",
                                "metadata": "latest-linux.yml",
                                "installer": "dnf",
                                "arches": ["x86_64", "amd64"],
                            }
                        ],
                        "configs": [],
                    }
                ),
                encoding="utf-8",
            )

            manifest = Manifest(repo, "fedora")
            entries = {entry.name: entry for entry in manifest.github_releases()}
            self.assertIn("paseo", entries)
            paseo = entries["paseo"]
            self.assertEqual(paseo.repo, "getpaseo/paseo")
            self.assertEqual(paseo.asset, "Paseo-*-x86_64.rpm")
            self.assertEqual(paseo.metadata, "latest-linux.yml")
            self.assertEqual(paseo.installer, "dnf")
            self.assertIn("x86_64", paseo.arches)

            cat = catalog.build_catalog(manifest, Mirrors())
            ids = {app["id"]: app for app in cat["apps"]}
            self.assertEqual(ids["release:paseo"]["source"], "release")


class ReleaseInstallerTests(unittest.TestCase):
    def test_parse_release_metadata_matches_pattern_and_rejects_traversal(self) -> None:
        text = """files:
  - url: ../evil-x86_64.rpm
    sha512: BAD==
  - url: Paseo-0.18.1-x86_64.rpm
    sha512: GOOD==
"""
        self.assertEqual(
            installers._parse_release_metadata(text, "Paseo-*-x86_64.rpm"),
            ("Paseo-0.18.1-x86_64.rpm", "GOOD=="),
        )
        self.assertIsNone(installers._parse_release_metadata(text, "*.rpm-missing"))

    def test_validate_release_asset_checks_magic_and_sha512(self) -> None:
        rpm_bytes = installers.RPM_MAGIC + b"fake-rpm-payload"
        good_sha = base64.b64encode(hashlib.sha512(rpm_bytes).digest()).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            good = root / "Paseo-0.18.1-x86_64.rpm"
            good.write_bytes(rpm_bytes)
            html = root / "err.rpm"
            html.write_text("<html>403</html>", encoding="utf-8")

            self.assertTrue(installers._validate_release_asset(good, ".rpm", good_sha))
            self.assertFalse(installers._validate_release_asset(good, ".rpm", "wrong=="))
            self.assertFalse(installers._validate_release_asset(html, ".rpm", ""))

    def test_install_from_metadata_uses_github_mirrors_and_dnf(self) -> None:
        rpm_bytes = installers.RPM_MAGIC + b"paseo-rpm-bytes"
        expected_sha = base64.b64encode(hashlib.sha512(rpm_bytes).digest()).decode("ascii")
        entry = ReleaseEntry(
            name="paseo",
            repo="getpaseo/paseo",
            asset="Paseo-*-x86_64.rpm",
            metadata="latest-linux.yml",
            installer="dnf",
            arches=["x86_64", "amd64"],
        )
        mirrors = Mirrors(github_proxies=["https://gh-proxy.com/"])
        downloads: list[tuple[list[str], int]] = []
        installed_paths: list[Path] = []

        def fake_download(urls, dest: Path, used_mirrors: Mirrors, validate=None, timeout=120) -> None:
            downloads.append((list(urls), timeout))
            self.assertIs(used_mirrors, mirrors)
            if dest.suffix == ".yml":
                dest.write_text(SAMPLE_LINUX_YML.format(sha512=expected_sha), encoding="utf-8")
            else:
                dest.write_bytes(rpm_bytes)
            if validate is not None:
                self.assertTrue(validate(dest))

        def fake_run(cmd: list[str], **kwargs) -> None:
            self.assertEqual(cmd[:3], ["dnf", "install", "-y"])
            self.assertTrue(cmd[3].endswith("Paseo-0.18.1-x86_64.rpm"))
            self.assertTrue(kwargs.get("sudo"))
            installed_paths.append(Path(cmd[3]))

        with mock.patch.object(installers.sysinfo, "ARCH", "x86_64"), mock.patch.object(
            installers.net, "download", side_effect=fake_download
        ), mock.patch.object(installers.sysinfo, "run", side_effect=fake_run) as run_cmd, redirect_stdout(
            io.StringIO()
        ):
            installers.install_github_release("fedora", entry, mirrors)

        run_cmd.assert_called_once()
        self.assertEqual(len(downloads), 2)
        self.assertEqual(
            downloads[0][0],
            [
                "https://gh-proxy.com/https://github.com/getpaseo/paseo/releases/latest/download/latest-linux.yml",
                "https://github.com/getpaseo/paseo/releases/latest/download/latest-linux.yml",
            ],
        )
        self.assertEqual(
            downloads[1][0],
            [
                "https://gh-proxy.com/https://github.com/getpaseo/paseo/releases/latest/download/Paseo-0.18.1-x86_64.rpm",
                "https://github.com/getpaseo/paseo/releases/latest/download/Paseo-0.18.1-x86_64.rpm",
            ],
        )
        self.assertEqual(downloads[1][1], 600)
        self.assertFalse(installed_paths[0].exists())

    def test_falls_back_to_github_api_when_metadata_fails(self) -> None:
        rpm_bytes = installers.RPM_MAGIC + b"api-fallback"
        entry = ReleaseEntry(
            name="paseo",
            repo="getpaseo/paseo",
            asset="Paseo-*-x86_64.rpm",
            metadata="latest-linux.yml",
            installer="dnf",
        )

        def fake_download(urls, dest: Path, used_mirrors: Mirrors, validate=None, timeout=120) -> None:
            if dest.suffix == ".yml":
                raise OSError("metadata unreachable")
            if dest.suffix == ".json":
                dest.write_text(
                    json.dumps(
                        {
                            "assets": [
                                {
                                    "name": "Paseo-0.18.1-x86_64.rpm",
                                    "browser_download_url": "https://github.com/getpaseo/paseo/releases/download/v0.18.1/Paseo-0.18.1-x86_64.rpm",
                                }
                            ]
                        }
                    ),
                    encoding="utf-8",
                )
            else:
                dest.write_bytes(rpm_bytes)
            if validate is not None:
                self.assertTrue(validate(dest))

        with mock.patch.object(installers.sysinfo, "ARCH", "x86_64"), mock.patch.object(
            installers.net, "download", side_effect=fake_download
        ), mock.patch.object(installers.sysinfo, "run") as run_cmd, redirect_stdout(io.StringIO()):
            installers.install_github_release("fedora", entry, Mirrors())

        run_cmd.assert_called_once()
        self.assertEqual(run_cmd.call_args.args[0][:3], ["dnf", "install", "-y"])

    def test_skips_unsupported_arch_and_existing_check(self) -> None:
        entry = ReleaseEntry(
            name="paseo",
            repo="getpaseo/paseo",
            asset="Paseo-*-x86_64.rpm",
            arches=["x86_64"],
        )
        with mock.patch.object(installers.sysinfo, "ARCH", "aarch64"), mock.patch.object(
            installers.net, "download"
        ) as download, mock.patch.object(installers.sysinfo, "warn") as warn:
            installers.install_github_release("fedora", entry, Mirrors())
        download.assert_not_called()
        warn.assert_called_once()

        checked = ReleaseEntry(
            name="paseo",
            repo="getpaseo/paseo",
            asset="Paseo-*-x86_64.rpm",
            check="Paseo",
        )
        with mock.patch.object(installers.sysinfo, "which", return_value="/usr/bin/Paseo"), mock.patch.object(
            installers.net, "download"
        ) as download, redirect_stdout(io.StringIO()):
            installers.install_github_release("fedora", checked, Mirrors())
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
