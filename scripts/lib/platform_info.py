"""Platform helpers: OS/profile detection, paths, commands, proxy env."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"
IS_TERMUX = Path("/data/data/com.termux").is_dir()
ARCH = platform.machine() or "unknown"

DRY_RUN = False


class CommandError(Exception):
    pass


def set_dry_run(value: bool) -> None:
    global DRY_RUN
    DRY_RUN = bool(value)


def detect_os() -> str:
    if IS_WINDOWS:
        return "windows"
    if IS_TERMUX:
        return "termux"
    release = Path("/etc/os-release")
    if release.is_file():
        text = release.read_text(encoding="utf-8", errors="ignore").lower()
        if "arch" in text or "manjaro" in text:
            return "arch"
        if "debian" in text or "ubuntu" in text:
            return "debian"
        if "fedora" in text:
            return "fedora"
        return "arch"
    if Path("/etc/arch-release").exists():
        return "arch"
    if Path("/etc/debian_version").exists():
        return "debian"
    if Path("/etc/fedora-release").exists():
        return "fedora"
    return "arch"


def home() -> Path:
    if IS_WINDOWS:
        return Path(os.environ.get("USERPROFILE") or Path.home())
    return Path(os.environ.get("HOME") or Path.home())


def local_appdata() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or (home() / "AppData" / "Local"))


def appdata() -> Path:
    return Path(os.environ.get("APPDATA") or (home() / "AppData" / "Roaming"))


def documents() -> Path:
    return Path(os.environ.get("USERPROFILE") or home()) / "Documents"


def scoop_root() -> Path:
    value = os.environ.get("SCOOP")
    return Path(value) if value else home() / "scoop"


def powershell_profile() -> Path:
    return documents() / "PowerShell" / "Microsoft.PowerShell_profile.ps1"


def expand_path(value: str) -> Path:
    text = (value or "").strip()
    if text == "~":
        return home()
    if text.startswith("~/") or text.startswith("~\\"):
        return home() / text[2:]
    if text == "$PROFILE":
        return powershell_profile()
    text = text.replace("%LOCALAPPDATA%", str(local_appdata()))
    text = text.replace("%APPDATA%", str(appdata()))
    text = text.replace("$SCOOP", str(scoop_root()))
    return Path(os.path.expandvars(text))


def which(command: str) -> str | None:
    return shutil.which(command)


def can_sudo() -> bool:
    if IS_WINDOWS or IS_TERMUX:
        return False
    return hasattr(os, "geteuid") and os.geteuid() != 0


def run(
    command: list[str],
    *,
    check: bool = True,
    capture: bool = False,
    env: dict[str, str] | None = None,
    cwd: Path | None = None,
    sudo: bool = False,
) -> subprocess.CompletedProcess:
    argv = list(command)
    printable = " ".join(argv)
    if IS_WINDOWS and argv:
        # CreateProcess only appends .exe, so PATHEXT shims (.CMD/.BAT) such as
        # scoop, npm and npx must be resolved to their full path before exec.
        resolved = shutil.which(argv[0])
        if resolved:
            argv[0] = resolved
    if sudo and can_sudo():
        argv = ["sudo", *argv]
        printable = f"sudo {printable}"
    if DRY_RUN:
        print(f"[dry-run] {printable}")
        return subprocess.CompletedProcess(argv, 0, "", "")

    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)

    try:
        result = subprocess.run(
            argv,
            check=False,
            text=True,
            capture_output=capture,
            env=merged_env,
            cwd=str(cwd) if cwd else None,
        )
    except FileNotFoundError as exc:
        raise CommandError(f"{command[0]}: command not found") from exc

    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise CommandError(f"{printable} exited with {result.returncode}" + (f": {detail}" if detail else ""))
    return result


def refresh_windows_path() -> None:
    if not IS_WINDOWS:
        return
    try:
        import winreg
    except ImportError:
        return
    parts: list[str] = []
    locations = (
        (winreg.HKEY_CURRENT_USER, r"Environment"),
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    )
    for root, subkey in locations:
        try:
            with winreg.OpenKey(root, subkey) as key:
                value, _ = winreg.QueryValueEx(key, "Path")
                if value:
                    parts.append(os.path.expandvars(str(value)))
        except OSError:
            continue
    if parts:
        os.environ["PATH"] = ";".join(parts)


def set_windows_user_env(name: str, value: str) -> None:
    os.environ[name] = value
    if not IS_WINDOWS:
        return
    try:
        import winreg
    except ImportError:
        return
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)


def apply_proxy_env(proxy: str) -> None:
    if not proxy:
        return
    os.environ["ALL_PROXY"] = proxy
    os.environ["all_proxy"] = proxy
    if not proxy.lower().startswith("socks"):
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            os.environ[key] = proxy
    os.environ["npm_config_proxy"] = proxy
    os.environ["npm_config_https_proxy"] = proxy


def info(message: str) -> None:
    print(f"\033[0;34m[INFO]\033[0m {message}")


def success(message: str) -> None:
    print(f"\033[0;32m[OK]\033[0m {message}")


def warn(message: str) -> None:
    print(f"\033[0;33m[WARN]\033[0m {message}")


def error(message: str) -> None:
    print(f"\033[0;31m[ERROR]\033[0m {message}", file=sys.stderr)
