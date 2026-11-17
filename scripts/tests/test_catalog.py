"""Offline tests for manifests, catalogs and mirror profiles."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import catalog, manifest  # noqa: E402

PROFILES = ("arch", "debian", "fedora", "termux", "windows")


class CatalogTests(unittest.TestCase):
    def test_all_profiles_build(self) -> None:
        mirrors = manifest.load_mirrors(REPO_DIR)
        for os_name in PROFILES:
            data = manifest.Manifest(REPO_DIR, os_name)
            built = catalog.build_catalog(data, mirrors)
            self.assertEqual(built["schema"], catalog.SCHEMA)
            app_ids = [app["id"] for app in built["apps"]]
            self.assertEqual(len(app_ids), len(set(app_ids)))
            config_ids = [entry["id"] for entry in built["configs"]]
            self.assertEqual(len(config_ids), len(set(config_ids)))
            for entry in data.configs():
                self.assertIn(entry.name, config_ids)
                if entry.method in ("link", "copy"):
                    self.assertTrue(
                        (REPO_DIR / entry.source).exists(),
                        f"{os_name}: missing source {entry.source}",
                    )

    def test_mirror_fields(self) -> None:
        data = manifest.Manifest(REPO_DIR, "windows")
        built = catalog.build_catalog(data, manifest.load_mirrors(REPO_DIR))
        fields = {field["id"]: field for field in built["mirrors"]["fields"]}
        self.assertEqual(set(fields), {"github", "npm", "pypi", "go", "scoop"})
        self.assertEqual(fields["pypi"]["type"], "list")
        self.assertEqual(fields["scoop"]["type"], "list")
        self.assertNotIn("uv-install", fields)

    def test_default_and_cn_profiles(self) -> None:
        default = manifest.load_mirrors(REPO_DIR)
        self.assertEqual(default.profile, "global")
        self.assertEqual(default.pypi_indexes, [])

        cn = manifest.load_mirrors(REPO_DIR, "cn")
        self.assertEqual(cn.profile, "cn")
        self.assertTrue(any("tuna" in url for url in cn.pypi_indexes))
        self.assertTrue(any("ustc" in url for url in cn.pypi_indexes))
        self.assertTrue(cn.github_proxies)

    def test_missing_profile(self) -> None:
        with self.assertRaises(manifest.ManifestError):
            manifest.load_mirrors(REPO_DIR, "does-not-exist")

    def test_resolve(self) -> None:
        available = ["a", "b"]
        self.assertEqual(catalog.resolve(None, available), {"a", "b"})
        self.assertEqual(catalog.resolve("all", available), {"a", "b"})
        self.assertEqual(catalog.resolve("none", available), set())
        self.assertEqual(catalog.resolve("a", available), {"a"})
        with self.assertRaises(catalog.SelectionError):
            catalog.resolve("missing", available)


if __name__ == "__main__":
    unittest.main()
