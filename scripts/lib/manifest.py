"""Manifest and mirror loading (manifest/<os>.json, manifest/mirror.json)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .messages import t


class ManifestError(Exception):
    pass


@dataclass
class ConfigEntry:
    name: str
    source: str = ""
    targets: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    if_missing: bool = False
    when: str = ""


class Manifest:
    def __init__(self, repo: Path, os_name: str):
        self.os_name = os_name
        self.path = repo / "manifest" / f"{os_name}.json"
        self.data = self._read(self.path)

    @staticmethod
    def _read(path: Path) -> dict:
        if not path.is_file():
            raise ManifestError(t("manifest.missing", path))
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError(t("manifest.invalid", path, exc)) from exc
        if not isinstance(data, dict):
            raise ManifestError(t("manifest.invalid", path, "root must be an object"))
        return data

    def array(self, key: str) -> list:
        value = self.data.get(key)
        return value if isinstance(value, list) else []

    def value(self, key: str, default: str = "") -> str:
        value = self.data.get(key, default)
        return "" if value is None else str(value)

    def configs(self) -> list[ConfigEntry]:
        entries: list[ConfigEntry] = []
        for raw in self.array("configs"):
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            targets = raw.get("targets")
            if not isinstance(targets, list):
                targets = [raw["target"]] if isinstance(raw.get("target"), str) else []
            exclude = raw.get("exclude")
            entries.append(
                ConfigEntry(
                    name=name,
                    source=str(raw.get("source") or ""),
                    targets=[str(item) for item in targets],
                    exclude=[str(item) for item in exclude] if isinstance(exclude, list) else [],
                    if_missing=bool(raw.get("ifMissing")),
                    when=str(raw.get("when") or ""),
                )
            )
        return entries


@dataclass
class Mirrors:
    profile: str = ""
    proxy: str = ""
    github_proxies: list[str] = field(default_factory=list)
    npm_registry: str = ""
    pypi_indexes: list[str] = field(default_factory=list)
    go_proxy: str = ""
    scoop_buckets: list[str] = field(default_factory=list)

    @property
    def github_proxy(self) -> str:
        return self.github_proxies[0] if self.github_proxies else ""

    def _github_prefixes(self) -> tuple[str, ...]:
        return (
            "https://github.com/",
            "https://raw.githubusercontent.com/",
            "https://gist.githubusercontent.com/",
        )

    def github(self, url: str) -> str:
        """Primary mirrored URL (or the original when no proxy is set)."""
        return self.github_urls(url)[0]

    def github_urls(self, url: str) -> list[str]:
        """All mirrored URLs in priority order."""
        if not self.github_proxies or not url.startswith(self._github_prefixes()):
            return [url]
        return [prefix.rstrip("/") + "/" + url for prefix in self.github_proxies]


def _text(value) -> str:
    if isinstance(value, list):
        value = next((item for item in value if str(item).strip()), "")
    return str(value or "").strip()


def _text_list(value) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _scoop_buckets(value) -> list[str]:
    if isinstance(value, dict):
        return [f"{name} = {url}" for name, url in value.items()]
    return _text_list(value)


def _read_mirror_data(repo: Path) -> dict | None:
    path = repo / "manifest" / "mirror.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _mirrors_from_section(section: dict, data: dict, profile: str) -> Mirrors:
    return Mirrors(
        profile=profile,
        proxy=_text(section.get("proxy")) or _text(data.get("proxy")),
        github_proxies=_text_list(section.get("githubProxy")),
        npm_registry=_text(section.get("npmRegistry")),
        pypi_indexes=_text_list(section.get("pypiIndex") or section.get("pipIndex")),
        go_proxy=_text(section.get("goProxy")),
        scoop_buckets=_scoop_buckets(section.get("scoopBuckets")),
    )


def load_mirrors(repo: Path, profile: str = "") -> Mirrors:
    """Load one mirror profile from manifest/mirror.json.

    Falls back to the flat legacy layout when no "profiles" object exists.
    """
    data = _read_mirror_data(repo)
    if not data:
        return Mirrors()

    profiles = data.get("profiles")
    selected = (profile or str(data.get("profile") or "")).strip()
    if isinstance(profiles, dict):
        if not selected:
            selected = "global" if "global" in profiles else next(iter(profiles), "")
        section = profiles.get(selected) if selected else None
        if not isinstance(section, dict):
            raise ManifestError(t("mirror.profile_missing", selected))
        return _mirrors_from_section(section, data, selected)

    return _mirrors_from_section(data, data, selected)


def load_mirror_profiles(repo: Path) -> tuple[str, dict[str, Mirrors]]:
    """Return (default profile name, {name: Mirrors}) for catalog generation."""
    data = _read_mirror_data(repo)
    if not data:
        return "", {}

    profiles = data.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        mirrors = load_mirrors(repo)
        name = mirrors.profile or "default"
        return name, {name: mirrors}

    default = str(data.get("profile") or "global")
    if default not in profiles:
        default = "global" if "global" in profiles else next(iter(profiles))

    result = {
        name: _mirrors_from_section(section, data, name)
        for name, section in profiles.items()
        if isinstance(section, dict)
    }
    if default not in result:
        default = next(iter(result))
    return default, result
