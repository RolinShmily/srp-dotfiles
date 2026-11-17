"""Tests for CHANGELOG.md section extraction."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SCRIPTS_DIR.parent

spec = importlib.util.spec_from_file_location("changelog", SCRIPTS_DIR / "changelog.py")
changelog = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(changelog)


class ChangelogTests(unittest.TestCase):
    def test_extracts_release_section(self) -> None:
        text = (REPO_DIR / "CHANGELOG.md").read_text(encoding="utf-8")
        section = changelog.extract_section(text, "1.0.1")
        self.assertIn("### Fixed", section)
        self.assertIn("Wrangler 4", section)
        self.assertNotIn("## [1.0.0]", section)

    def test_accepts_v_prefix(self) -> None:
        text = "## [1.2.3] - 2024-01-01\n\n### Added\n\n- thing\n"
        self.assertIn("thing", changelog.extract_section(text, "v1.2.3"))

    def test_missing_version(self) -> None:
        with self.assertRaises(changelog.ChangelogError):
            changelog.extract_section("## [1.0.0] - 2024-01-01\n\n- thing\n", "9.9.9")


if __name__ == "__main__":
    unittest.main()
