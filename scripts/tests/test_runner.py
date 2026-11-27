"""Offline tests for interactive startup menu and step confirmation."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import main as cli  # noqa: E402
from lib.runner import Runner  # noqa: E402


class RunnerConfirmTests(unittest.TestCase):
    def test_all_enables_assume_yes_for_remaining_steps(self) -> None:
        runner = Runner(assume_yes=False, dry_run=False)
        with mock.patch("builtins.input", side_effect=["a"]) as prompt:
            self.assertTrue(runner.confirm("step-1"))
            self.assertTrue(runner.assume_yes)
            self.assertTrue(runner.confirm("step-2"))
        self.assertEqual(prompt.call_count, 1)

    def test_no_skips_only_current_step(self) -> None:
        runner = Runner(assume_yes=False, dry_run=False)
        with mock.patch("builtins.input", side_effect=["n", ""]):
            self.assertFalse(runner.confirm("step-1"))
            self.assertFalse(runner.assume_yes)
            self.assertTrue(runner.confirm("step-2"))


class StartupMenuTests(unittest.TestCase):
    def test_default_enter_selects_full_auto(self) -> None:
        buf = io.StringIO()
        with mock.patch("builtins.input", side_effect=[""]), redirect_stdout(buf):
            self.assertEqual(cli.choose_startup_mode("windows"), ("all", True))

    def test_choices_map_to_expected_modes(self) -> None:
        cases = [
            ("1", ("all", True)),
            ("2", ("all", False)),
            ("3", ("config", True)),
            ("4", ("config", False)),
            ("q", None),
        ]
        for raw, expected in cases:
            with self.subTest(choice=raw), mock.patch("builtins.input", side_effect=[raw]), redirect_stdout(
                io.StringIO()
            ):
                self.assertEqual(cli.choose_startup_mode("arch"), expected)

    def test_eof_cancels_menu(self) -> None:
        with mock.patch("builtins.input", side_effect=EOFError()), redirect_stdout(io.StringIO()):
            self.assertIsNone(cli.choose_startup_mode("arch"))

    def test_invalid_input_reprompts(self) -> None:
        buf = io.StringIO()
        with mock.patch("builtins.input", side_effect=["nope", "3"]), redirect_stdout(buf):
            self.assertEqual(cli.choose_startup_mode("arch"), ("config", True))
        self.assertIn("Invalid choice: nope", buf.getvalue())

    def test_main_uses_menu_when_no_args_and_tty(self) -> None:
        with mock.patch.object(cli.sysinfo, "detect_os", return_value="windows"), mock.patch.object(
            cli.sysinfo, "IS_WINDOWS", True
        ), mock.patch.object(cli.sys.stdin, "isatty", return_value=True), mock.patch.object(
            cli, "choose_startup_mode", return_value=("config", True)
        ) as menu, mock.patch.object(
            cli, "run_action", return_value=0
        ) as run_action:
            code = cli.main([])

        self.assertEqual(code, 0)
        menu.assert_called_once_with("windows")
        self.assertEqual(run_action.call_args.args[0], "config")
        self.assertTrue(run_action.call_args.args[3])

    def test_main_returns_zero_when_menu_cancelled(self) -> None:
        with mock.patch.object(cli.sysinfo, "detect_os", return_value="windows"), mock.patch.object(
            cli.sysinfo, "IS_WINDOWS", True
        ), mock.patch.object(cli.sys.stdin, "isatty", return_value=True), mock.patch.object(
            cli, "choose_startup_mode", return_value=None
        ), mock.patch.object(
            cli, "run_action"
        ) as run_action, redirect_stdout(io.StringIO()):
            code = cli.main([])

        self.assertEqual(code, 0)
        run_action.assert_not_called()

    def test_main_skips_menu_when_args_given(self) -> None:
        with mock.patch.object(cli.sysinfo, "detect_os", return_value="windows"), mock.patch.object(
            cli.sysinfo, "IS_WINDOWS", True
        ), mock.patch.object(cli.sys.stdin, "isatty", return_value=True), mock.patch.object(
            cli, "choose_startup_mode"
        ) as menu, mock.patch.object(
            cli, "run_action", return_value=0
        ) as run_action:
            code = cli.main(["-c"])

        self.assertEqual(code, 0)
        menu.assert_not_called()
        self.assertEqual(run_action.call_args.args[0], "config")
        self.assertFalse(run_action.call_args.args[3])

    def test_main_rejects_no_args_without_tty(self) -> None:
        with mock.patch.object(cli.sysinfo, "detect_os", return_value="windows"), mock.patch.object(
            cli.sysinfo, "IS_WINDOWS", True
        ), mock.patch.object(cli.sys.stdin, "isatty", return_value=False), mock.patch.object(
            cli, "choose_startup_mode"
        ) as menu, mock.patch.object(
            cli, "run_action"
        ) as run_action, redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = cli.main([])

        self.assertEqual(code, 2)
        menu.assert_not_called()
        run_action.assert_not_called()


if __name__ == "__main__":
    unittest.main()
