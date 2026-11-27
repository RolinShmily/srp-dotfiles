"""Offline tests for login shell handling."""

from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers  # noqa: E402
from lib.manifest import Mirrors  # noqa: E402


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


class OhMyZshInstallTests(unittest.TestCase):
    def test_skips_when_oh_my_zsh_entrypoint_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            omz = home / ".oh-my-zsh"
            omz.mkdir()
            (omz / "oh-my-zsh.sh").write_text("# ok\n", encoding="utf-8")
            with mock.patch.object(installers.sysinfo, "home", return_value=home), mock.patch.object(
                installers.net, "git_clone"
            ) as clone, redirect_stdout(io.StringIO()):
                installers.install_omz(Mirrors())

        clone.assert_not_called()

    def test_reclones_partial_directory_via_mirrors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".oh-my-zsh").mkdir()  # leftover empty directory without oh-my-zsh.sh
            mirrors = Mirrors(github_proxies=["https://gh-proxy.com/"])

            def fake_clone(url: str, dest: Path, used_mirrors: Mirrors) -> None:
                self.assertEqual(url, "https://github.com/ohmyzsh/ohmyzsh.git")
                self.assertIs(used_mirrors, mirrors)
                dest.mkdir(parents=True, exist_ok=True)
                (dest / "oh-my-zsh.sh").write_text("# cloned\n", encoding="utf-8")

            with mock.patch.object(installers.sysinfo, "home", return_value=home), mock.patch.object(
                installers.net, "git_clone", side_effect=fake_clone
            ) as clone, redirect_stdout(io.StringIO()):
                installers.install_omz(mirrors)

            clone.assert_called_once()
            self.assertTrue((home / ".oh-my-zsh" / "oh-my-zsh.sh").is_file())

    def test_raises_when_clone_leaves_no_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with mock.patch.object(installers.sysinfo, "home", return_value=home), mock.patch.object(
                installers.net, "git_clone"
            ), redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    installers.install_omz(Mirrors())

    def test_setup_plugins_skips_partial_omz_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".oh-my-zsh").mkdir()
            with mock.patch.object(installers.sysinfo, "home", return_value=home), mock.patch.object(
                installers.net, "git_clone"
            ) as clone, redirect_stdout(io.StringIO()):
                installers.setup_omz_plugins(Mirrors())

        clone.assert_not_called()

    def test_set_default_shell_prints_exec_zsh_hint_when_still_in_bash(self) -> None:
        buf = io.StringIO()
        with mock.patch.object(installers.sysinfo, "which", return_value="/usr/bin/zsh"), mock.patch.object(
            installers, "login_user", return_value="alice"
        ), mock.patch.object(installers, "_shell_matches", side_effect=[False, True]), mock.patch.object(
            installers.sysinfo, "run"
        ), mock.patch.dict(os.environ, {"SHELL": "/bin/bash"}, clear=False), redirect_stdout(buf):
            installers.set_default_shell("termux")

        self.assertIn("exec zsh", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
