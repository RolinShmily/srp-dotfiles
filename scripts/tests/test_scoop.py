"""Offline tests for Scoop availability and graceful skips."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers, platform_info  # noqa: E402


class ScoopAvailableTests(unittest.TestCase):
    def test_adds_shims_directory_to_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shims = root / "shims"
            shims.mkdir()
            with mock.patch.object(platform_info, "scoop_root", return_value=root), \
                 mock.patch.object(platform_info, "which", side_effect=[None, "scoop"]), \
                 mock.patch.dict(os.environ, {"PATH": ""}, clear=False):
                self.assertTrue(installers.scoop_available())
                self.assertEqual(os.environ["PATH"], str(shims))

    def test_missing_scoop_stays_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(platform_info, "scoop_root", return_value=Path(tmp)), \
                 mock.patch.object(platform_info, "which", return_value=None):
                self.assertFalse(installers.scoop_available())


class ScoopSkipTests(unittest.TestCase):
    def test_scoop_install_skips_without_scoop(self) -> None:
        with mock.patch.object(platform_info, "which", return_value=None), \
             mock.patch.object(platform_info, "scoop_root", return_value=Path("/nonexistent-srp")), \
             mock.patch.object(platform_info, "warn") as warn, \
             mock.patch.object(platform_info, "run") as run:
            installers.scoop_install("vim")
        warn.assert_called_once()
        run.assert_not_called()

    def test_buckets_skip_without_scoop(self) -> None:
        mirrors = mock.Mock(scoop_buckets=["extras = https://example.com/extras"])
        with mock.patch.object(platform_info, "which", return_value=None), \
             mock.patch.object(platform_info, "scoop_root", return_value=Path("/nonexistent-srp")), \
             mock.patch.object(platform_info, "warn") as warn, \
             mock.patch.object(platform_info, "run") as run:
            installers.configure_scoop_buckets(mirrors)
        warn.assert_called_once()
        run.assert_not_called()

    def test_aria2_skips_without_scoop(self) -> None:
        manifest = mock.Mock()
        manifest.array.return_value = ["aria2"]
        with mock.patch.object(platform_info, "which", return_value=None), \
             mock.patch.object(platform_info, "scoop_root", return_value=Path("/nonexistent-srp")), \
             mock.patch.object(platform_info, "warn") as warn, \
             mock.patch.object(platform_info, "run") as run:
            installers.configure_aria2(manifest)
        warn.assert_called_once()
        run.assert_not_called()

    def test_uv_python_skips_when_uv_missing(self) -> None:
        with mock.patch.object(platform_info, "which", return_value=None), \
             mock.patch.object(platform_info, "warn") as warn, \
             mock.patch.object(platform_info, "run") as run:
            installers.install_uv_python()
        warn.assert_called_once()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
