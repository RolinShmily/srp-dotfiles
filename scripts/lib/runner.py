"""Step runner: per-step confirmation, retry/skip/abort, audit report."""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from typing import Callable

from . import platform_info as sysinfo
from .messages import t


@dataclass
class Results:
    success: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)


class Runner:
    def __init__(self, assume_yes: bool = False, dry_run: bool = False):
        self.assume_yes = assume_yes
        self.dry_run = dry_run
        self.results = Results()
        self.last_interrupt = 0.0

    def _ask(self, prompt: str, default: str) -> str:
        try:
            answer = input(prompt).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return default
        return answer or default

    def confirm(self, name: str, core: bool = True) -> bool:
        if self.assume_yes or self.dry_run:
            return True
        level = t("label.core") if core else t("label.optional")
        answer = self._ask(t("prompt.confirm", name, level), "y")
        if answer in ("a", "all"):
            self.assume_yes = True
            return True
        return answer in ("y", "yes")

    def run(self, name: str, fn: Callable[[], None], core: bool = True) -> bool:
        if self.dry_run:
            print(f"[dry-run] {name}")
            self.results.skipped.append(f"{name} (dry-run)")
            return True

        if not self.confirm(name, core):
            sysinfo.warn(t("step.cancelled", name))
            self.results.skipped.append(f"{name} (cancelled)")
            return False

        while True:
            sysinfo.info(t("step.running", name))
            try:
                fn()
            except KeyboardInterrupt:
                now = time.time()
                if now - self.last_interrupt <= 1.2:
                    print()
                    sysinfo.error(t("step.aborted"))
                    self.results.failed.append(f"{name} (double Ctrl+C)")
                    raise SystemExit(130)
                self.last_interrupt = now
                print()
                sysinfo.warn(t("step.interrupted", name))
                self.results.skipped.append(f"{name} (interrupted)")
                return False
            except Exception as exc:  # noqa: BLE001 - surfaced to the user
                sysinfo.error(t("step.failed", name, exc))
                if not sys.stdin.isatty():
                    self.results.failed.append(f"{name} ({exc})")
                    return False
                print(t("prompt.failure"))
                print(t("prompt.skip"))
                print(t("prompt.retry"))
                print(t("prompt.abort"))
                choice = self._ask(t("prompt.choice"), "s")
                if choice.startswith("r"):
                    sysinfo.info(t("step.retrying", name))
                    continue
                if choice.startswith("a"):
                    self.results.failed.append(f"{name} (aborted by user)")
                    raise SystemExit(1)
                self.results.skipped.append(f"{name} (skipped after error: {exc})")
                return False

            sysinfo.success(name)
            self.results.success.append(name)
            return True

    def stage(self, title: str) -> None:
        print(f"\n=== {title} ===")

    def report(self, os_name: str = "", arch: str = "") -> None:
        results = self.results
        print("\n" + "=" * 60)
        print(t("report.title"))
        if os_name:
            print(t("report.os", os_name, arch or sysinfo.ARCH))
        print("=" * 60)
        for label, items in (
            (t("report.success", len(results.success)), results.success),
            (t("report.skipped", len(results.skipped)), results.skipped),
            (t("report.failed", len(results.failed)), results.failed),
        ):
            if items:
                print(label)
                for item in items:
                    print(f"  - {item}")
        if results.success and not results.skipped and not results.failed:
            print(t("report.complete"))
        elif results.failed or results.skipped:
            print(t("report.hint"))
        print("=" * 60)
