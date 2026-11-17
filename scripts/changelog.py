#!/usr/bin/env python3
"""Extract a version section from CHANGELOG.md."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_DIR / "CHANGELOG.md"


class ChangelogError(Exception):
    pass


def extract_section(text: str, version: str) -> str:
    version = version.strip().lstrip("v")
    pattern = re.compile(
        rf"^##\s+\[?v?{re.escape(version)}\]?(?:\s+-.*)?\s*$", re.MULTILINE
    )
    match = pattern.search(text)
    if not match:
        raise ChangelogError(f"version {version} not found in {CHANGELOG.name}")

    start = match.end()
    following = re.search(r"^##\s+", text[start:], re.MULTILINE)
    end = start + following.start() if following else len(text)
    section = text[start:end].strip()
    if not section:
        raise ChangelogError(f"version {version} has no release notes")
    return section + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("Usage: python scripts/changelog.py <version>", file=sys.stderr)
        return 2
    try:
        section = extract_section(CHANGELOG.read_text(encoding="utf-8"), argv[0])
    except (OSError, ChangelogError) as exc:
        print(exc, file=sys.stderr)
        return 1
    sys.stdout.write(section)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
