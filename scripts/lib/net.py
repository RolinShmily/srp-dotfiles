"""Downloads and clones with optional GitHub mirror and proxy support."""

from __future__ import annotations

import shutil
import tempfile
import urllib.request
from pathlib import Path
from typing import Callable

from . import platform_info as sysinfo
from .manifest import Mirrors
from .messages import t


def _download_one(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "srp-dotfiles"})
    with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def _download_with_curl(url: str, dest: Path, proxy: str) -> None:
    cmd = ["curl", "-fsSL", "--connect-timeout", "20", "--max-time", "120"]
    if proxy:
        cmd += ["--proxy", proxy]
    cmd += ["-o", str(dest), url]
    sysinfo.run(cmd)


def download(
    url: str | list[str],
    dest: Path,
    mirrors: Mirrors,
    validate: Callable[[Path], bool] | None = None,
) -> None:
    """Download to dest, trying each URL until one delivers usable bytes.

    Mirror prefixes fail in ways that still look like success (a 200 carrying an
    error page), so callers that expect a specific format pass a validator and
    the next candidate is tried when it fails.
    """
    urls = [url] if isinstance(url, str) else list(url)
    if sysinfo.DRY_RUN:
        print(f"[dry-run] download {urls[0]} -> {dest}")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    proxy = mirrors.proxy
    last_error: Exception | None = None
    for candidate in urls:
        try:
            if proxy.lower().startswith("socks") and sysinfo.which("curl"):
                _download_with_curl(candidate, dest, proxy)
            else:
                try:
                    _download_one(candidate, dest)
                except Exception:
                    if not sysinfo.which("curl"):
                        raise
                    dest.unlink(missing_ok=True)
                    _download_with_curl(candidate, dest, proxy)
            if validate is not None and not validate(dest):
                raise ValueError(t("net.bad_content", candidate))
            return
        except Exception as exc:  # try the next mirror
            last_error = exc
            dest.unlink(missing_ok=True)
    if last_error is not None:
        raise last_error


def proxy_env(mirrors: Mirrors) -> dict[str, str]:
    """Proxy variables for the tools that fetch GitHub themselves (git, sh)."""
    if not mirrors.proxy:
        return {}
    return {
        name: mirrors.proxy
        for name in ("ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
    }


def git_clone(url: str, dest: Path, mirrors: Mirrors) -> None:
    """Clone url, walking every mirrored URL until one of them works."""
    if sysinfo.DRY_RUN:
        print(f"[dry-run] git clone {url} -> {dest}")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    env = proxy_env(mirrors)
    last_error: Exception | None = None
    for candidate in mirrors.github_urls(url):
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        try:
            sysinfo.run(["git", "clone", "--depth=1", candidate, str(dest)], capture=True, env=env)
            sysinfo.info(t("net.cloned", candidate))
            return
        except Exception as exc:  # a mirror can serve raw files and still refuse git
            last_error = exc
            sysinfo.warn(t("net.clone_failed", candidate))
    if last_error is not None:
        raise last_error
