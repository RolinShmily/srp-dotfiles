"""Execution context shared with custom deployment modules."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .manifest import Manifest, Mirrors
from .runner import Runner


@dataclass
class Context:
    repo: Path
    os_name: str
    manifest: Manifest
    mirrors: Mirrors
    backup_dir: Path
    force: bool
    runner: Runner
