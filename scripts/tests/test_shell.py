"""Offline tests for login shell handling."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers  # noqa: E402


class LoginUserTests(unittest.TestCase):
    def test_sudo_user_wins(self) -> None:
        with mock.patch.dict(os.environ, {"SUDO_USER": "alice", "USER": "root"}, clear=False):
            self.assertEqual(installers.login_user(), "alice")

    def test_falls_back_to_user_without_sudo(self) -> None:
        env = {key: value for key, value in os.environ.items() if key != "SUDO_USER"}
        env["USER"] = "bob"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(installers.login_user(), "bob")


class ShellMatchTests(unittest.TestCase):
    def test_own_shell_matches_itself(self) -> None:
        if not hasattr(os, "getuid"):
            self.skipTest("no pwd module on this platform")
        import pwd

        user = pwd.getpwuid(os.getuid()).pw_name
        shell = pwd.getpwnam(user).pw_shell
        self.assertTrue(installers._shell_matches(user, shell))

    def test_missing_user_does_not_match(self) -> None:
        if not hasattr(os, "getuid"):
            self.skipTest("no pwd module on this platform")
        self.assertFalse(installers._shell_matches("no-such-user-srp", "/bin/zsh"))

    def test_symlinked_shell_counts_as_the_same(self) -> None:
        if not hasattr(os, "getuid"):
            self.skipTest("no pwd module on this platform")
        import pwd

        user = pwd.getpwuid(os.getuid()).pw_name
        shell = Path(pwd.getpwnam(user).pw_shell)
        if "zsh" not in shell.name:
            self.skipTest("login shell is not zsh on this runner")
        self.assertTrue(installers._shell_matches(user, "/usr/bin/zsh"))
        self.assertTrue(installers._shell_matches(user, "/bin/zsh"))

    def test_unknown_shell_does_not_match(self) -> None:
        if not hasattr(os, "getuid"):
            self.skipTest("no pwd module on this platform")
        import pwd

        user = pwd.getpwuid(os.getuid()).pw_name
        self.assertFalse(installers._shell_matches(user, "/nonexistent/zsh"))


if __name__ == "__main__":
    unittest.main()
