"""Offline tests for dnf system package installation."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers  # noqa: E402


def completed(command: list[str], returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(command, returncode, "", "")


class DnfInstallTests(unittest.TestCase):
    def test_conflicting_package_is_skipped_with_warning(self) -> None:
        calls: list[list[str]] = []

        def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
            calls.append(command)
            if command[0] == "dnf":
                return completed(command)
            installed = command[-1] != "ffmpeg-free"
            return completed(command, 0 if installed else 1)

        with mock.patch.object(installers.sysinfo, "run", side_effect=fake_run), mock.patch.object(
            installers.sysinfo, "warn"
        ) as warn:
            installers.install_system_packages("fedora", "dnf", ["zsh", "ffmpeg-free"])

        self.assertEqual(
            calls[0], ["dnf", "install", "-y", "--skip-broken", "zsh", "ffmpeg-free"]
        )
        warn.assert_called_once()
        self.assertIn("ffmpeg-free", warn.call_args.args[0])

    def test_warning_free_when_everything_landed(self) -> None:
        with mock.patch.object(
            installers.sysinfo, "run", side_effect=lambda command, **kwargs: completed(command)
        ), mock.patch.object(installers.sysinfo, "warn") as warn:
            installers.install_system_packages("fedora", "dnf", ["zsh", "git"])

        warn.assert_not_called()

    def test_failure_without_installed_packages_raises(self) -> None:
        with mock.patch.object(
            installers.sysinfo,
            "run",
            side_effect=lambda command, **kwargs: completed(command, 1),
        ), mock.patch.object(installers.sysinfo, "warn"):
            with self.assertRaises(installers.sysinfo.CommandError):
                installers.install_system_packages("fedora", "dnf", ["zsh", "git"])


if __name__ == "__main__":
    unittest.main()
