#!/usr/bin/env python3
"""Regenerate worker/public/catalog.json from manifest/<os>.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import catalog, manifest  # noqa: E402

PROFILES = ("arch", "debian", "fedora", "termux", "windows")
OUTPUT = REPO_DIR / "worker" / "public" / "catalog.json"


def build() -> dict:
    default_profile, profiles = manifest.load_mirror_profiles(REPO_DIR)
    fallback = next(iter(profiles.values())) if profiles else manifest.Mirrors()
    catalogs = {}
    for os_name in PROFILES:
        data = manifest.Manifest(REPO_DIR, os_name)
        catalogs[os_name] = catalog.build_catalog(
            data, fallback, profiles, default_profile
        )
    return {"schema": catalog.SCHEMA, "catalogs": catalogs}


def main(argv: list[str]) -> int:
    data = build()
    if "--check" in argv:
        if not OUTPUT.is_file():
            print(f"missing {OUTPUT}", file=sys.stderr)
            return 1
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if existing != data:
            print(f"{OUTPUT} is out of date; run: python scripts/gen_catalog.py", file=sys.stderr)
            return 1
        print(f"{OUTPUT} is up to date")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
