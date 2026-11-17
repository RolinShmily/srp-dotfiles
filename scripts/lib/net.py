"""Downloads with optional GitHub mirror and proxy support."""

from __future__ import annotations

import shutil
import tempfile
import urllib.request
from pathlib import Path

from . import platform_info as sysinfo
from .manifest import Mirrors


def _download_one(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "srp-dotfiles"})
    with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def download(url: str | list[str], dest: Path, mirrors: Mirrors) -> None:
    """Download to dest, trying each URL in order until one succeeds."""
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
                sysinfo.run(["curl", "-fL", "--proxy", proxy, "-o", str(dest), candidate])
            else:
                _download_one(candidate, dest)
            return
        except Exception as exc:  # try the next mirror
            last_error = exc
            dest.unlink(missing_ok=True)
    if last_error is not None:
        raise last_error
