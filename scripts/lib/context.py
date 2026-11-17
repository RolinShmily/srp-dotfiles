"""Execution context for config dispatch."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .runner import Runner


@dataclass
class Context:
    repo: Path
    backup_dir: Path
    runner: Runner
