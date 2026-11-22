"""Tests for the cross-platform command runner in lib.platform_info."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import platform_info  # noqa: E402


class WindowsShimResolutionTests(unittest.TestCase):
    def test_cmd_shim_resolved_before_exec(self) -> None:
        completed = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.object(platform_info, "IS_WINDOWS", True), mock.patch.object(
            platform_info.shutil, "which", return_value=r"C:\scoop\shims\scoop.CMD"
        ) as which, mock.patch.object(
            platform_info.subprocess, "run", return_value=completed
        ) as run:
            platform_info.run(["scoop", "bucket", "list"], capture=True)

        which.assert_called_once_with("scoop")
        self.assertEqual(
            run.call_args.args[0],
            [r"C:\scoop\shims\scoop.CMD", "bucket", "list"],
        )

    def test_unresolved_command_keeps_bare_name_in_error(self) -> None:
        with mock.patch.object(platform_info, "IS_WINDOWS", True), mock.patch.object(
            platform_info.shutil, "which", return_value=None
        ), mock.patch.object(
            platform_info.subprocess, "run", side_effect=FileNotFoundError()
        ):
            with self.assertRaises(platform_info.CommandError) as ctx:
                platform_info.run(["scoop", "bucket", "list"])

        self.assertEqual(str(ctx.exception), "scoop: command not found")

    def test_resolution_skipped_off_windows(self) -> None:
        completed = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.object(platform_info, "IS_WINDOWS", False), mock.patch.object(
            platform_info.shutil, "which"
        ) as which, mock.patch.object(
            platform_info.subprocess, "run", return_value=completed
        ) as run:
            platform_info.run(["scoop", "bucket", "list"])

        which.assert_not_called()
        self.assertEqual(run.call_args.args[0], ["scoop", "bucket", "list"])


if __name__ == "__main__":
    unittest.main()
