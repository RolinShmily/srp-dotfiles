"""Offline tests for package-manager tolerance (pacman, apt, pkg)."""

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


class PacmanFallbackTests(unittest.TestCase):
    def test_conflicting_package_warns_and_keeps_the_rest(self) -> None:
        calls: list[list[str]] = []

        def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
            calls.append(command)
            # The batch mirrors pacman's all-or-nothing transaction.
            if len(command) > 5:
                return completed(command, 1)
            return completed(command, 0 if command[-1] != "zathura-pdf-poppler" else 1)

        with mock.patch.object(installers.sysinfo, "run", side_effect=fake_run), mock.patch.object(
            installers.sysinfo, "warn"
        ) as warn:
            installers.install_system_packages(
                "arch", "pacman", ["zathura", "zathura-pdf-poppler"]
            )

        self.assertEqual(
            calls[0],
            ["pacman", "-Syu", "--needed", "--noconfirm", "zathura", "zathura-pdf-poppler"],
        )
        # Retries reuse the synced database instead of another full upgrade.
        self.assertEqual(calls[1], ["pacman", "-S", "--needed", "--noconfirm", "zathura"])
        self.assertEqual(
            calls[2], ["pacman", "-S", "--needed", "--noconfirm", "zathura-pdf-poppler"]
        )
        self.assertEqual(warn.call_count, 2)
        self.assertIn("zathura-pdf-poppler", warn.call_args.args[0])

    def test_nothing_installed_still_fails(self) -> None:
        with mock.patch.object(
            installers.sysinfo,
            "run",
            side_effect=lambda command, **kwargs: completed(command, 1),
        ), mock.patch.object(installers.sysinfo, "warn"):
            with self.assertRaises(installers.sysinfo.CommandError):
                installers.install_system_packages("arch", "pacman", ["zsh", "git"])


class AptFallbackTests(unittest.TestCase):
    def test_uninstallable_package_warns_instead_of_failing(self) -> None:
        def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
            if command[:3] == ["apt-get", "update", "-y"]:
                return completed(command)
            if command[:2] == ["apt-cache", "show"]:
                return completed(command)
            if len(command) > 4:
                return completed(command, 1)
            return completed(command, 0 if command[-1] != "fastfetch" else 1)

        with mock.patch.object(installers.sysinfo, "run", side_effect=fake_run), mock.patch.object(
            installers.sysinfo, "warn"
        ) as warn:
            installers.install_system_packages("debian", "apt", ["git", "fastfetch"])

        messages = [call.args[0] for call in warn.call_args_list]
        self.assertTrue(any("fastfetch" in message for message in messages), messages)


class TermuxFallbackTests(unittest.TestCase):
    def test_missing_package_warns_instead_of_failing(self) -> None:
        def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
            if command[:3] == ["pkg", "install", "-y"] and len(command) > 4:
                return completed(command, 1)
            return completed(command, 0 if command[-1] != "yazi" else 1)

        with mock.patch.object(installers.sysinfo, "run", side_effect=fake_run), mock.patch.object(
            installers.sysinfo, "warn"
        ) as warn:
            installers.install_system_packages("termux", "pkg", ["git", "yazi"])

        messages = [call.args[0] for call in warn.call_args_list]
        self.assertTrue(any("yazi" in message for message in messages), messages)


if __name__ == "__main__":
    unittest.main()
