"""Installation steps for Unix and Windows."""

from __future__ import annotations

import configparser
import getpass
import os
import re
import shlex
import shutil
import tempfile
import zipfile
from pathlib import Path

from . import net
from . import platform_info as sysinfo
from .i18n import t
from .manifest import Manifest, Mirrors

MAPLE_URL = "https://github.com/subframe7536/maple-font/releases/latest/download/MapleMono-NF-CN.zip"


# --------------------------------------------------------------------- Unix

def install_system_packages(os_name: str, package_manager: str, packages: list[str]) -> None:
    if not packages:
        return
    if package_manager == "pacman":
        sysinfo.run(["pacman", "-Syu", "--needed", "--noconfirm", *packages], sudo=True)
    elif package_manager == "apt":
        sysinfo.run(["apt-get", "update", "-y"], sudo=True)
        sysinfo.run(["apt-get", "install", "-y", *packages], sudo=True)
    elif package_manager == "dnf":
        sysinfo.run(["dnf", "install", "-y", *packages], sudo=True)
    elif package_manager == "pkg":
        sysinfo.run(["pkg", "install", "-y", *packages])
    else:
        sysinfo.warn(t("pkg.unknown_os", package_manager))


def enable_copr(repo: str) -> None:
    sysinfo.run(["dnf", "copr", "enable", "-y", repo], sudo=True)


def set_default_shell(os_name: str) -> None:
    zsh = sysinfo.which("zsh")
    if not zsh:
        sysinfo.warn(t("shell.missing"))
        return
    if os_name == "termux":
        if os.environ.get("SHELL") != zsh:
            sysinfo.run(["chsh", "-s", zsh], check=False)
        sysinfo.success(t("shell.done"))
        return

    shells = Path("/etc/shells")
    if shells.exists() and zsh not in shells.read_text(encoding="utf-8").splitlines():
        sysinfo.run(["sh", "-c", f'echo "{zsh}" >> /etc/shells'], sudo=True, check=False)
    user = os.environ.get("USER") or getpass.getuser()
    if os.environ.get("SHELL") != zsh:
        sysinfo.run(["chsh", "-s", zsh, user], sudo=True, check=False)
    sysinfo.success(t("shell.done"))


def install_omz(mirrors: Mirrors) -> None:
    if (sysinfo.home() / ".oh-my-zsh").is_dir():
        sysinfo.info(t("omz.already"))
        return

    installer_urls = mirrors.github_urls(
        "https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh"
    )
    repo_url = mirrors.github("https://github.com/ohmyzsh/ohmyzsh.git")
    with tempfile.NamedTemporaryFile(suffix=".sh", delete=False) as handle:
        script = Path(handle.name)
    try:
        net.download(installer_urls, script, mirrors)
        sysinfo.run(
            ["sh", str(script)],
            env={"RUNZSH": "no", "REMOTE": repo_url, "CHSH": "no"},
            check=False,
        )
    finally:
        script.unlink(missing_ok=True)
    sysinfo.success(t("omz.done"))


def install_font(unix_os: str, font_name: str, mirrors: Mirrors) -> None:
    if font_name not in ("MapleMono-NF-CN", "Maple-Mono-NF-CN"):
        sysinfo.warn(t("font.unknown", font_name))
        return

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as handle:
        archive = Path(handle.name)
    try:
        if unix_os == "termux":
            target = sysinfo.home() / ".termux" / "font.ttf"
            if target.is_file():
                sysinfo.info(t("font.already", font_name, target))
                return
            target.parent.mkdir(parents=True, exist_ok=True)
            sysinfo.info(t("font.downloading", font_name))
            net.download(mirrors.github_urls(MAPLE_URL), archive, mirrors)
            with zipfile.ZipFile(archive) as bundle:
                target.write_bytes(bundle.read("MapleMono-NF-CN-Regular.ttf"))
            if sysinfo.which("termux-reload-settings"):
                sysinfo.run(["termux-reload-settings"], check=False)
            sysinfo.success(t("font.installed", font_name, target))
            return

        font_dir = sysinfo.home() / ".local" / "share" / "fonts" / "MapleMono-NF-CN"
        if font_dir.is_dir() and any(font_dir.glob("*.ttf")):
            sysinfo.info(t("font.already", font_name, font_dir))
            return
        font_dir.mkdir(parents=True, exist_ok=True)
        sysinfo.info(t("font.downloading", font_name))
        net.download(mirrors.github_urls(MAPLE_URL), archive, mirrors)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(font_dir)
        if sysinfo.which("fc-cache"):
            sysinfo.run(["fc-cache", "-f", str(font_dir)], check=False)
        sysinfo.success(t("font.installed", font_name, font_dir))
    except Exception:
        sysinfo.warn(t("font.failed", font_name))
        if not mirrors.github_proxy and not mirrors.proxy:
            sysinfo.warn(t("font.hint"))
        raise
    finally:
        archive.unlink(missing_ok=True)


def npm_install(unix_os: str, package: str, mirrors: Mirrors) -> None:
    if not sysinfo.which("npm"):
        sysinfo.warn(t("npm.missing", package))
        return
    args = ["npm", "install", "-g", "--ignore-scripts"]
    if mirrors.npm_registry:
        args.append(f"--registry={mirrors.npm_registry}")
    args.append(package)
    if unix_os == "termux":
        sysinfo.run(args)
    else:
        try:
            sysinfo.run(args, sudo=True)
        except Exception:
            sysinfo.run(args)
    sysinfo.success(t("npm.done", package))


def install_skill(item: str) -> None:
    parts = shlex.split(item)
    if not parts:
        return
    if sysinfo.which("skills"):
        if not any(part in ("-a", "--agent") for part in parts):
            parts += ["-a", "pi"]
        sysinfo.run(["skills", "add", *parts, "-g", "-y"])
    elif sysinfo.which("npx"):
        if not any(part in ("-a", "--agent") for part in parts):
            parts += ["-a", "pi"]
        sysinfo.run(["npx", "--yes", "skills", "add", *parts, "-g", "-y"])
    else:
        sysinfo.warn(t("skill.missing", item))
        return
    sysinfo.success(t("skill.done", item))


# ------------------------------------------------------------------ Windows

def set_execution_policy() -> None:
    sysinfo.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force",
        ]
    )


def winget_install(package_id: str) -> None:
    if not sysinfo.which("winget"):
        sysinfo.warn(t("winget.missing"))
        return
    args = [
        "winget",
        "install",
        "--id",
        package_id,
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]
    if package_id == "Git.Git":
        args.append("-e")
    sysinfo.run(args)


def install_scoop(mirrors: Mirrors) -> None:
    if not sysinfo.which("scoop"):
        installer_urls = (
            mirrors.github_urls(
                "https://raw.githubusercontent.com/ScoopInstaller/Install/master/install.ps1"
            )
            if mirrors.github_proxies
            else ["https://get.scoop.sh"]
        )
        with tempfile.NamedTemporaryFile(suffix=".ps1", delete=False) as handle:
            script = Path(handle.name)
        try:
            net.download(installer_urls, script, mirrors)
            sysinfo.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)]
            )
        finally:
            script.unlink(missing_ok=True)
        sysinfo.refresh_windows_path()
    if not sysinfo.which("scoop"):
        raise RuntimeError(t("scoop.missing"))
    sysinfo.success(t("scoop.setup"))


def configure_scoop_buckets(mirrors: Mirrors) -> None:
    if not mirrors.scoop_buckets:
        sysinfo.info(t("scoop.buckets_empty"))
        return

    installed = sysinfo.run(["scoop", "bucket", "list"], capture=True, check=False).stdout or ""
    for entry in mirrors.scoop_buckets:
        if "=" not in entry:
            continue
        name, url = (part.strip() for part in entry.split("=", 1))
        url = mirrors.github(url)
        if name == "main":
            if re.search(rf"\b{re.escape(name)}\b", installed):
                sysinfo.run(["scoop", "bucket", "rm", "main"], check=False)
            sysinfo.run(["scoop", "bucket", "add", "main", url])
        elif not re.search(rf"\b{re.escape(name)}\b", installed):
            sysinfo.run(["scoop", "bucket", "add", name, url])


def scoop_install(package: str) -> None:
    sysinfo.run(["scoop", "install", package])


def configure_aria2(manifest: Manifest) -> None:
    if "aria2" not in manifest.array("scoopPackages"):
        return
    sysinfo.run(["scoop", "install", "aria2"])
    shims = sysinfo.home() / "scoop" / "shims"
    if shims.is_dir() and str(shims) not in os.environ.get("PATH", ""):
        os.environ["PATH"] = str(shims) + os.pathsep + os.environ.get("PATH", "")
    for key, value in (
        ("aria2-enabled", "true"),
        ("aria2-warning-enabled", "false"),
        ("aria2-retry-wait", "2"),
        ("aria2-split", "3"),
        ("aria2-max-connection-per-server", "3"),
        ("aria2-min-split-size", "5M"),
    ):
        sysinfo.run(["scoop", "config", key, value], check=False)


def install_uv(mirrors: Mirrors) -> None:
    if sysinfo.which("uv"):
        return
    with tempfile.NamedTemporaryFile(suffix=".ps1", delete=False) as handle:
        script = Path(handle.name)
    try:
        net.download(mirrors.uv_installer(), script, mirrors)
        sysinfo.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)]
        )
    finally:
        script.unlink(missing_ok=True)
    sysinfo.refresh_windows_path()
    if not sysinfo.which("uv"):
        raise RuntimeError(t("uv.missing"))


def install_uv_python() -> None:
    sysinfo.run(["uv", "python", "install"])


def install_font_windows(font_name: str, mirrors: Mirrors) -> None:
    if font_name not in ("MapleMono-NF-CN", "Maple-Mono-NF-CN"):
        sysinfo.warn(t("font.unknown", font_name))
        return

    font_dir = sysinfo.local_appdata() / "Microsoft" / "Windows" / "Fonts"
    if font_dir.is_dir() and any(font_dir.glob("MapleMono-NF-CN*.ttf")):
        sysinfo.info(t("font.already", font_name, font_dir))
        return

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as handle:
        archive = Path(handle.name)
    extract_dir = Path(tempfile.mkdtemp(prefix="srp_font_"))
    try:
        sysinfo.info(t("font.downloading", font_name))
        net.download(mirrors.github_urls(MAPLE_URL), archive, mirrors)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(extract_dir)
        font_dir.mkdir(parents=True, exist_ok=True)

        try:
            import winreg
        except ImportError:
            winreg = None  # type: ignore[assignment]

        count = 0
        for font in extract_dir.rglob("*.ttf"):
            dest = font_dir / font.name
            shutil.copy2(font, dest)
            if winreg is not None:
                with winreg.CreateKeyEx(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows NT\CurrentVersion\Fonts",
                    0,
                    winreg.KEY_SET_VALUE,
                ) as key:
                    winreg.SetValueEx(key, font.stem, 0, winreg.REG_SZ, str(dest))
            count += 1
        if count == 0:
            raise RuntimeError(f"No ttf files in {font_name} archive")
        _broadcast_font_change()
        sysinfo.success(t("font.installed", font_name, font_dir))
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(extract_dir, ignore_errors=True)


def _broadcast_font_change() -> None:
    try:
        import ctypes

        result = ctypes.c_ulong()
        ctypes.windll.user32.SendMessageTimeoutW(  # type: ignore[attr-defined]
            0xFFFF, 0x001D, 0, 0, 0, 1000, ctypes.byref(result)
        )
    except Exception:
        pass


# --------------------------------------------------------------- configs

def setup_omz_plugins(mirrors: Mirrors) -> None:
    ohmyzsh = sysinfo.home() / ".oh-my-zsh"
    if not ohmyzsh.is_dir():
        return
    custom = Path(os.environ.get("ZSH_CUSTOM") or ohmyzsh / "custom")
    clones = (
        (
            custom / "plugins" / "zsh-autosuggestions",
            "https://github.com/zsh-users/zsh-autosuggestions.git",
        ),
        (
            custom / "plugins" / "zsh-syntax-highlighting",
            "https://github.com/zsh-users/zsh-syntax-highlighting.git",
        ),
        (
            custom / "themes" / "spaceship-prompt",
            "https://github.com/spaceship-prompt/spaceship-prompt.git",
        ),
    )
    (custom / "plugins").mkdir(parents=True, exist_ok=True)
    (custom / "themes").mkdir(parents=True, exist_ok=True)
    for dest, url in clones:
        if dest.exists():
            continue
        sysinfo.run(["git", "clone", mirrors.github(url), str(dest)])
    theme_link = custom / "themes" / "spaceship.zsh-theme"
    source = custom / "themes" / "spaceship-prompt" / "spaceship.zsh-theme"
    if source.is_file() and not theme_link.exists():
        try:
            theme_link.symlink_to(source)
        except OSError:
            shutil.copy2(source, theme_link)


def configure_windows_environment() -> None:
    sysinfo.set_windows_user_env("SHELL", "pwsh.exe")
    sysinfo.set_windows_user_env("ZELLIJ_SHELL", "pwsh.exe")


def pip_config_path() -> Path:
    if sysinfo.IS_WINDOWS:
        return sysinfo.appdata() / "pip" / "pip.ini"
    base = Path(os.environ.get("XDG_CONFIG_HOME") or (sysinfo.home() / ".config"))
    return base / "pip" / "pip.conf"


def configure_pypi_mirror(mirrors: Mirrors) -> None:
    if not mirrors.pypi_indexes:
        return
    path = pip_config_path()
    parser = configparser.ConfigParser(interpolation=None)
    if path.is_file():
        parser.read(path, encoding="utf-8")
    if not parser.has_section("global"):
        parser.add_section("global")
    parser.set("global", "index-url", mirrors.pypi_indexes[0])
    if len(mirrors.pypi_indexes) > 1:
        parser.set("global", "extra-index-url", " ".join(mirrors.pypi_indexes[1:]))

    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("# Managed by srp-dotfiles mirror settings\n")
        parser.write(handle)
    temp.replace(path)
    sysinfo.success(t("pypi.done", path))


def configure_go_mirror(mirrors: Mirrors) -> None:
    if not mirrors.go_proxy:
        return
    if not sysinfo.which("go"):
        sysinfo.info(t("go.missing"))
        return
    sysinfo.run(["go", "env", "-w", f"GOPROXY={mirrors.go_proxy}"])
    sysinfo.success(t("go.done"))


def configure_git() -> None:
    if not sysinfo.which("git"):
        sysinfo.warn(t("git.missing"))
        return
    sysinfo.run(["git", "config", "--global", "core.autocrlf", "input"])
    sysinfo.success(t("git.done"))


# Re-exported for main's dispatch helpers.
__all__ = [
    "install_font",
    "install_font_windows",
    "install_omz",
    "install_scoop",
    "install_skill",
    "install_system_packages",
    "install_uv",
    "npm_install",
    "configure_pypi_mirror",
    "configure_go_mirror",
    "scoop_install",
    "winget_install",
]
