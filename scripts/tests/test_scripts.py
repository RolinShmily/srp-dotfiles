"""Offline tests for standalone manifest script installers."""

from __future__ import annotations

import io
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
from lib.manifest import Manifest, Mirrors, ScriptEntry  # noqa: E402


class ScriptManifestAndCatalogTests(unittest.TestCase):
    def test_windows_and_fedora_declare_herdr_tui_without_herdr_core_or_paseo(self) -> None:
        for os_name, expected_shell in (("windows", "powershell"), ("fedora", "sh")):
            manifest = Manifest(REPO_DIR, os_name)
            entries = {entry.name: entry for entry in manifest.scripts()}
            self.assertNotIn("herdr-core", entries, os_name)
            self.assertIn("herdr-tui", entries, os_name)
            self.assertEqual(entries["herdr-tui"].shell, expected_shell)

            cat = catalog.build_catalog(manifest, Mirrors())
            ids = {app["id"]: app for app in cat["apps"]}
            self.assertNotIn("script:herdr-core", ids, os_name)
            self.assertEqual(ids["script:herdr-tui"]["source"], "script")
            self.assertNotIn("winget:Paseo.Paseo", ids, os_name)
            self.assertNotIn("npm:@getpaseo/cli", ids, os_name)
            self.assertNotIn("release:paseo", ids, os_name)

    def test_debian_excludes_herdr_and_paseo(self) -> None:
        manifest = Manifest(REPO_DIR, "debian")
        self.assertEqual(manifest.scripts(), [])
        cat = catalog.build_catalog(manifest, Mirrors())
        ids = {app["id"]: app for app in cat["apps"]}
        self.assertNotIn("script:herdr-core", ids)
        self.assertNotIn("script:herdr-tui", ids)
        self.assertNotIn("npm:@getpaseo/cli", ids)

    def test_windows_fedora_and_debian_include_tailscale_magpie_and_pi(self) -> None:
        fedora = catalog.build_catalog(Manifest(REPO_DIR, "fedora"), Mirrors())
        fedora_ids = {app["id"]: app for app in fedora["apps"]}
        self.assertEqual(fedora_ids["script:tailscale"]["source"], "script")
        self.assertEqual(fedora_ids["script:magpie"]["source"], "script")

        windows = catalog.build_catalog(Manifest(REPO_DIR, "windows"), Mirrors())
        windows_ids = {app["id"]: app for app in windows["apps"]}
        self.assertEqual(windows_ids["winget:Tailscale.Tailscale"]["source"], "winget")
        self.assertEqual(windows_ids["scoop:magpie/magpie-app"]["source"], "scoop")

        debian = catalog.build_catalog(Manifest(REPO_DIR, "debian"), Mirrors())
        debian_ids = {app["id"]: app for app in debian["apps"]}
        debian_configs = {cfg["id"] for cfg in debian["configs"]}
        self.assertEqual(debian_ids["pkg:npm"]["source"], "apt")
        self.assertEqual(debian_ids["npm:@earendil-works/pi-coding-agent"]["source"], "npm")
        self.assertIn("pi", debian_configs)


class ScriptInstallerTests(unittest.TestCase):
    def test_looks_like_script_rejects_empty_and_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            empty = root / "empty.sh"
            empty.write_text("", encoding="utf-8")
            html = root / "err.sh"
            html.write_text("\ufeff  <!DOCTYPE html><html>403</html>", encoding="utf-8")
            valid = root / "ok.sh"
            valid.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")

            self.assertFalse(installers._looks_like_script(empty))
            self.assertFalse(installers._looks_like_script(html))
            self.assertTrue(installers._looks_like_script(valid))

    def test_unix_script_downloads_and_executes_with_merged_env(self) -> None:
        entry = ScriptEntry(
            name="herdr-tui",
            url="https://herdr.dev/install.sh",
            shell="sh",
            args=["--quiet"],
            env={"HERDR_CHANNEL": "stable"},
        )
        mirrors = Mirrors(proxy="http://127.0.0.1:7890")
        seen_paths: list[Path] = []

        def fake_download(urls, dest: Path, used_mirrors: Mirrors, validate=None) -> None:
            self.assertEqual(urls, ["https://herdr.dev/install.sh"])
            self.assertIs(used_mirrors, mirrors)
            dest.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            self.assertTrue(validate(dest))
            seen_paths.append(dest)

        with mock.patch.object(installers.sysinfo, "IS_WINDOWS", False), mock.patch.object(
            installers.net, "download", side_effect=fake_download
        ), mock.patch.object(installers.sysinfo, "run") as run_cmd, redirect_stdout(io.StringIO()):
            installers.install_script("fedora", entry, mirrors)

        run_cmd.assert_called_once()
        cmd = run_cmd.call_args.args[0]
        env = run_cmd.call_args.kwargs["env"]
        self.assertEqual(cmd[0], "sh")
        self.assertTrue(cmd[1].endswith(".sh"))
        self.assertEqual(cmd[2:], ["--quiet"])
        self.assertEqual(env["HERDR_CHANNEL"], "stable")
        self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:7890")
        self.assertFalse(seen_paths[0].exists())

    def test_windows_powershell_script_uses_bypass_and_refreshes_path(self) -> None:
        entry = ScriptEntry(
            name="herdr-tui",
            url="https://herdr.dev/install.ps1",
            shell="powershell",
        )
        mirrors = Mirrors()

        def fake_download(urls, dest: Path, used_mirrors: Mirrors, validate=None) -> None:
            dest.write_text("Write-Output ok\n", encoding="utf-8")
            self.assertTrue(validate(dest))

        with mock.patch.object(installers.sysinfo, "which", return_value="pwsh.exe"), mock.patch.object(
            installers.net, "download", side_effect=fake_download
        ), mock.patch.object(installers.sysinfo, "run") as run_cmd, mock.patch.object(
            installers.sysinfo, "refresh_windows_path"
        ) as refresh, redirect_stdout(io.StringIO()):
            installers.install_script("windows", entry, mirrors)

        cmd = run_cmd.call_args.args[0]
        self.assertEqual(cmd[:5], ["pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        self.assertTrue(cmd[5].endswith(".ps1"))
        self.assertIsNone(run_cmd.call_args.kwargs["env"])
        refresh.assert_called_once()

    def test_windows_powershell_fallback_clears_psmodulepath(self) -> None:
        entry = ScriptEntry(
            name="herdr-tui",
            url="https://herdr.dev/install.ps1",
            shell="powershell",
        )

        def fake_download(urls, dest: Path, used_mirrors: Mirrors, validate=None) -> None:
            dest.write_text("Write-Output ok\n", encoding="utf-8")

        with mock.patch.object(installers.sysinfo, "which", return_value=None), mock.patch.object(
            installers.net, "download", side_effect=fake_download
        ), mock.patch.object(installers.sysinfo, "run") as run_cmd, mock.patch.object(
            installers.sysinfo, "refresh_windows_path"
        ), redirect_stdout(io.StringIO()):
            installers.install_script("windows", entry, Mirrors())

        cmd = run_cmd.call_args.args[0]
        self.assertEqual(cmd[:5], ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        self.assertEqual(run_cmd.call_args.kwargs["env"], {"PSModulePath": None})

    def test_skips_when_check_command_or_path_exists(self) -> None:
        entry_cmd = ScriptEntry(name="tool", url="https://example.test/install.sh", check="tool")
        with mock.patch.object(installers.sysinfo, "which", return_value="/usr/bin/tool"), mock.patch.object(
            installers.net, "download"
        ) as download, redirect_stdout(io.StringIO()):
            installers.install_script("fedora", entry_cmd, Mirrors())
        download.assert_not_called()

        with tempfile.TemporaryDirectory() as tmp:
            existing = Path(tmp) / "bin" / "tool"
            existing.parent.mkdir()
            existing.write_text("", encoding="utf-8")
            entry_path = ScriptEntry(
                name="tool", url="https://example.test/install.sh", check=str(existing)
            )
            with mock.patch.object(installers.net, "download") as download, redirect_stdout(io.StringIO()):
                installers.install_script("fedora", entry_path, Mirrors())
            download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
