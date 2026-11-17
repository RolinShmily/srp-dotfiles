"""Pi configuration deployment (copy + resource injection)."""

from __future__ import annotations

import json
from pathlib import Path

from lib import deploy
from lib import platform_info as sysinfo
from lib.context import Context
from lib.i18n import t


def _resolve(value: str, repo: Path) -> str:
    source = str(value).strip()
    if source.startswith("@repo/"):
        return str(repo / source[len("@repo/") :])
    if source == "~":
        return str(sysinfo.home())
    if source.startswith("~/"):
        return str(sysinfo.home() / source[2:])
    return source


def _inject(settings_path: Path, ctx: Context) -> None:
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    resources = ctx.manifest.data.get("piResources")
    if not isinstance(resources, dict):
        return
    for key in ("packages", "extensions", "skills", "prompts"):
        existing = settings.get(key) if isinstance(settings.get(key), list) else []
        incoming = resources.get(key) if isinstance(resources.get(key), list) else []
        merged = list(existing)
        for item in incoming:
            if not isinstance(item, str) or not item.strip():
                continue
            resolved = _resolve(item, ctx.repo)
            if resolved not in merged:
                merged.append(resolved)
        settings[key] = merged

    temp = settings_path.with_name(settings_path.name + ".tmp")
    temp.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    temp.replace(settings_path)


def run(ctx: Context) -> None:
    source = ctx.repo / "config" / "pi"
    target = sysinfo.home() / ".pi" / "agent"
    if not source.is_dir():
        sysinfo.warn(t("pi.missing", source))
        return

    target.mkdir(parents=True, exist_ok=True)
    backup = ctx.backup_dir
    force = ctx.force

    agents = source / "AGENTS.md"
    if agents.is_file():
        deploy.copy_item(agents, target / "AGENTS.md", backup, force)

    settings_example = source / "settings.json.example"
    settings_target = target / "settings.json"
    if settings_example.is_file():
        deploy.copy_example_item(settings_example, settings_target, backup, force)
        _inject(settings_target, ctx)
        example_copy = Path(str(settings_target) + ".example")
        if example_copy.is_file():
            _inject(example_copy, ctx)

    for name in ("mcp.json", "keybindings.json"):
        example = source / f"{name}.example"
        if example.is_file():
            deploy.copy_example_item(example, target / name, backup, force)

    sysinfo.success(t("pi.done", target))
