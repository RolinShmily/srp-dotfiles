"""Offline tests for the message catalog.

Guards against the two ways a message table rots: a key that is used but never
defined (the CLI prints the raw key) and a key that is defined but never used.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from lib.messages import MESSAGES  # noqa: E402

USAGE = re.compile(r'\bt\(\s*"([^"]+)"')


def used_keys() -> set[str]:
    keys: set[str] = set()
    for path in SCRIPTS_DIR.rglob("*.py"):
        if "tests" in path.parts:
            continue
        keys.update(USAGE.findall(path.read_text(encoding="utf-8")))
    return keys


class MessageTests(unittest.TestCase):
    def test_every_used_key_is_defined(self) -> None:
        missing = sorted(used_keys() - set(MESSAGES))
        self.assertEqual(missing, [], f"undefined message keys: {missing}")

    def test_no_unused_keys(self) -> None:
        unused = sorted(set(MESSAGES) - used_keys())
        self.assertEqual(unused, [], f"unused message keys: {unused}")

    def test_placeholders_are_sequential(self) -> None:
        for key, text in MESSAGES.items():
            self.assertNotIn("{}", text, f"{key} uses an anonymous placeholder")
            indices = sorted({int(i) for i in re.findall(r"\{(\d+)\}", text)})
            self.assertEqual(indices, list(range(len(indices))), f"{key} skips a placeholder")
            text.format(*["x"] * len(indices))


if __name__ == "__main__":
    unittest.main()
