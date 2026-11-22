"""Offline tests for winget exit-code handling."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers, platform_info  # noqa: E402


def completed(returncode: int) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(["winget"], returncode)


class WingetInstallTests(unittest.TestCase):
    def install(self, returncode: int) -> None:
        with mock.patch.object(platform_info, "which", return_value="winget"), \
             mock.patch.object(platform_info, "run", return_value=completed(returncode)):
            installers.winget_install("Microsoft.PowerShell")

    def test_update_not_applicable_is_success(self) -> None:
        with mock.patch.object(platform_info, "info") as info:
            self.install(installers.WINGET_UPDATE_NOT_APPLICABLE)
        info.assert_called_once()

    def test_signed_exit_code_is_success(self) -> None:
        with mock.patch.object(platform_info, "info") as info:
            self.install(installers.WINGET_UPDATE_NOT_APPLICABLE - 2**32)
        info.assert_called_once()

    def test_other_nonzero_exit_still_fails(self) -> None:
        with self.assertRaises(platform_info.CommandError):
            self.install(1)


if __name__ == "__main__":
    unittest.main()
