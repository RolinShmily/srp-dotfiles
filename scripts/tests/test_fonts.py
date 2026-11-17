"""Offline tests for the font registry and archive extraction."""

from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import installers  # noqa: E402


class FontTests(unittest.TestCase):
    def test_registry(self) -> None:
        for name in ("MapleMono-NF-CN", "Inter", "SourceHanSansSC"):
            self.assertIn(name, installers.FONT_SPECS)
        self.assertEqual(
            installers.FONT_SPECS["MapleMono-NF-CN"].scoop_package,
            "Maple-Mono-NF-CN",
        )
        self.assertIn("Maple-Mono-NF-CN", installers.FONT_SPECS)
        self.assertTrue(installers.FONT_SPECS["Inter"].url.endswith("Inter-4.1.zip"))
        self.assertIsNone(installers.FONT_SPECS["Inter"].termux_member)

    def test_extract_filters_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "font.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("fonts/InterVariable.ttf", b"font")
                bundle.writestr("fonts/InterVariable.woff2", b"web")
                bundle.writestr("LICENSE.txt", b"license")
            target = root / "out"
            count = installers._extract_fonts(
                archive, target, installers.FONT_SPECS["Inter"]
            )
            self.assertEqual(count, 1)
            self.assertTrue((target / "InterVariable.ttf").is_file())
            self.assertFalse((target / "InterVariable.woff2").exists())
            self.assertFalse((target / "LICENSE.txt").exists())

    def test_has_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertFalse(installers._has_fonts(root))
            (root / "LICENSE.txt").write_text("x", encoding="utf-8")
            self.assertFalse(installers._has_fonts(root))
            (root / "SourceHanSansSC-Regular.otf").write_bytes(b"font")
            self.assertTrue(installers._has_fonts(root))

    def test_empty_archive_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "font.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("LICENSE.txt", b"license")
            with self.assertRaises(RuntimeError):
                installers._extract_fonts(
                    archive, root / "out", installers.FONT_SPECS["SourceHanSansSC"]
                )


if __name__ == "__main__":
    unittest.main()
