"""Decoupled catalog: apps, configs and mirror profiles.

Apps are concrete packages from the manifest, not preset groups:

  pkg:<name>     Unix system package
  winget:<id>    Windows winget package
  scoop:<name>   Windows Scoop package
  font:<name>    Maple Mono font
  npm:<name>     global npm package
  skill:<item>   agent skill
  script:<name>  standalone official install script
  release:<name> GitHub release package installer
"""

from __future__ import annotations

from dataclasses import dataclass

from .manifest import Manifest

SCHEMA = 8


def mirror_fields(os_name: str) -> list[tuple[str, str, str]]:
    fields = [
        ("github", "GitHub proxy", "list"),
        ("npm", "npm registry", "text"),
        ("pypi", "PyPI index", "list"),
        ("go", "Go proxy", "text"),
    ]
    if os_name == "windows":
        fields.append(("scoop", "Scoop buckets", "list"))
    return fields


def _mirror_value(mirrors, field_id: str):
    return {
        "github": mirrors.github_proxies,
        "npm": mirrors.npm_registry,
        "pypi": mirrors.pypi_indexes,
        "go": mirrors.go_proxy,
        "scoop": mirrors.scoop_buckets,
    }[field_id]


def build_mirrors(mirrors, os_name: str, profiles=None, default_profile="") -> dict:
    fields = mirror_fields(os_name)
    profiles = profiles or {default_profile or "default": mirrors}
    if not default_profile:
        default_profile = next(iter(profiles))
    return {
        "default": default_profile,
        "proxy": profiles[default_profile].proxy,
        "fields": [
            {"id": field_id, "label": label, "type": field_type}
            for field_id, label, field_type in fields
        ],
        "profiles": {
            name: {field_id: _mirror_value(profile, field_id) for field_id, _, _ in fields}
            for name, profile in profiles.items()
        },
    }


class SelectionError(Exception):
    def __init__(self, unknown: str, available: list[str]):
        super().__init__(unknown)
        self.unknown = unknown
        self.available = available


@dataclass(frozen=True)
class App:
    id: str
    source: str
    name: str


def build_catalog(manifest: Manifest, mirrors, profiles=None, default_profile="") -> dict:
    apps: list[App] = []

    def add(app_id: str, source: str, name: str) -> None:
        if any(app.id == app_id for app in apps):
            return
        apps.append(App(app_id, source, name))

    if manifest.os_name == "windows":
        for package in manifest.array("wingetPackages"):
            add(f"winget:{package}", "winget", str(package))
        for package in manifest.array("scoopPackages"):
            add(f"scoop:{package}", "scoop", str(package))
        for font in manifest.array("fonts"):
            add(f"font:{font}", "font", str(font))
    else:
        manager = manifest.value("packageManager") or manifest.os_name
        for package in manifest.array("packages"):
            add(f"pkg:{package}", manager, str(package))
        for font in manifest.array("fonts"):
            add(f"font:{font}", "font", str(font))

    for package in manifest.array("npmGlobals"):
        add(f"npm:{package}", "npm", str(package))
    for item in manifest.array("skillsAdd"):
        add(f"skill:{item}", "skill", str(item))
    for entry in manifest.scripts():
        add(f"script:{entry.name}", "script", entry.name)
    for entry in manifest.github_releases():
        add(f"release:{entry.name}", "release", entry.name)

    return {
        "schema": SCHEMA,
        "os": manifest.os_name,
        "apps": [
            {"id": app.id, "source": app.source, "name": app.name, "label": app.name}
            for app in apps
        ],
        "configs": [{"id": entry.name, "label": entry.name} for entry in manifest.configs()],
        "mirrors": build_mirrors(mirrors, manifest.os_name, profiles, default_profile),
    }


def resolve(selection: str | None, available: list[str]) -> set[str]:
    """Resolve a comma separated selection. None = everything."""
    if selection is None:
        return set(available)

    tokens = [token.strip() for token in selection.split(",") if token.strip()]
    if not tokens:
        raise SelectionError("", sorted(available))

    selected: set[str] = set()
    for token in tokens:
        if token == "all":
            selected |= set(available)
        elif token == "none":
            continue
        elif token in available:
            selected.add(token)
        else:
            raise SelectionError(token, sorted(available))
    return selected
