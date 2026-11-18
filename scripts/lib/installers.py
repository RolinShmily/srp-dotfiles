"""Installation steps for Unix and Windows."""

from __future__ import annotations

import configparser
import fnmatch
import getpass
import os
import re
import shlex
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from . import net
from . import platform_info as sysinfo
from .messages import t
from .manifest import Manifest, Mirrors

MAPLE_URL = "https://github.com/subframe7536/maple-font/releases/latest/download/MapleMono-NF-CN.zip"

FONT_SUFFIXES = (".ttf", ".otf", ".ttc")


@dataclass(frozen=True)
class FontSpec:
    id: str
    url: str
    patterns: tuple[str, ...]
    prefix: str
    termux_member: str | None = None
    scoop_package: str | None = None


FONT_SPECS = {
    "MapleMono-NF-CN": FontSpec(
        id="MapleMono-NF-CN",
        url=MAPLE_URL,
        patterns=("*.ttf",),
        prefix="MapleMono-NF-CN",
        termux_member="MapleMono-NF-CN-Regular.ttf",
        scoop_package="Maple-Mono-NF-CN",
    ),
    "Inter": FontSpec(
        id="Inter",
        url="https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip",
        patterns=("InterVariable.ttf", "InterVariable-Italic.ttf"),
        prefix="Inter",
    ),
    "SourceHanSansSC": FontSpec(
        id="SourceHanSansSC",
        url="https://github.com/adobe-fonts/source-han-sans/releases/download/2.005R/09_SourceHanSansSC.zip",
        patterns=("*.otf",),
        prefix="SourceHanSansSC",
    ),
}
# The Windows manifest uses the hyphenated family name.
FONT_SPECS["Maple-Mono-NF-CN"] = FONT_SPECS["MapleMono-NF-CN"]


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


def login_user() -> str:
    """Account that actually logged in.

    sudo keeps the caller in SUDO_USER while USER/SHELL describe the target
    account, so reading USER alone changes root's shell instead of yours.
    """
    return os.environ.get("SUDO_USER") or os.environ.get("USER") or getpass.getuser()


def _shell_matches(user: str, shell: str) -> bool:
    """Compare real paths: /bin/zsh and /usr/bin/zsh are the same shell."""
    try:
        import pwd
    except ImportError:
        return os.environ.get("SHELL") == shell
    try:
        current = pwd.getpwnam(user).pw_shell
    except KeyError:
        return False
    return os.path.realpath(current) == os.path.realpath(shell)


def set_default_shell(os_name: str) -> None:
    zsh = sysinfo.which("zsh")
    if not zsh:
        sysinfo.warn(t("shell.missing"))
        return

    user = login_user()
    if _shell_matches(user, zsh):
        sysinfo.info(t("shell.already", zsh, user))
        return

    if os_name == "termux":
        sysinfo.run(["chsh", "-s", zsh], check=False)
    else:
        shells = Path("/etc/shells")
        listed = shells.read_text(encoding="utf-8").splitlines() if shells.exists() else []
        if zsh not in listed:
            sysinfo.run(["sh", "-c", f'echo "{zsh}" >> /etc/shells'], sudo=True, check=False)
        sysinfo.run(["chsh", "-s", zsh, user], sudo=True, check=False)

    if _shell_matches(user, zsh):
        sysinfo.success(t("shell.done", zsh, user))
    else:
        sysinfo.warn(t("shell.failed", user, zsh))


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
            env={"RUNZSH": "no", "REMOTE": repo_url, "CHSH": "no", **net.proxy_env(mirrors)},
            check=False,
        )
    finally:
        script.unlink(missing_ok=True)

    target = sysinfo.home() / ".oh-my-zsh"
    if not target.is_dir():
        # Its installer clones REMOTE inside itself, so a mirror that refuses
        # git leaves nothing behind; clone with the full fallback chain.
        sysinfo.warn(t("omz.fallback"))
        net.git_clone("https://github.com/ohmyzsh/ohmyzsh.git", target, mirrors)
    sysinfo.success(t("omz.done"))


def _has_fonts(font_dir: Path) -> bool:
    return font_dir.is_dir() and any(
        path.is_file() and path.suffix.lower() in FONT_SUFFIXES
        for path in font_dir.iterdir()
    )


def _extract_fonts(archive: Path, target: Path, spec: FontSpec) -> int:
    target.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if (
                name.lower().endswith(FONT_SUFFIXES)
                and any(fnmatch.fnmatch(name, pattern) for pattern in spec.patterns)
            ):
                (target / name).write_bytes(bundle.read(info))
                count += 1
    if count == 0:
        raise RuntimeError(f"No font files in {archive.name} for {spec.id}")
    return count


def install_font(unix_os: str, font_name: str, mirrors: Mirrors) -> None:
    spec = FONT_SPECS.get(font_name)
    if spec is None:
        sysinfo.warn(t("font.unknown", font_name))
        return

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as handle:
        archive = Path(handle.name)
    extract_dir = Path(tempfile.mkdtemp(prefix="srp_font_"))
    try:
        if unix_os == "termux":
            if spec.termux_member is None:
                sysinfo.warn(t("font.termux_unsupported", font_name))
                return
            target = sysinfo.home() / ".termux" / "font.ttf"
            if target.is_file():
                sysinfo.info(t("font.already", font_name, target))
                return
            target.parent.mkdir(parents=True, exist_ok=True)
            sysinfo.info(t("font.downloading", font_name))
            net.download(
                mirrors.github_urls(spec.url), archive, mirrors, validate=zipfile.is_zipfile
            )
            with zipfile.ZipFile(archive) as bundle:
                target.write_bytes(bundle.read(spec.termux_member))
            if sysinfo.which("termux-reload-settings"):
                sysinfo.run(["termux-reload-settings"], check=False)
            sysinfo.success(t("font.installed", font_name, target))
            return

        font_dir = sysinfo.home() / ".local" / "share" / "fonts" / spec.id
        if _has_fonts(font_dir):
            sysinfo.info(t("font.already", font_name, font_dir))
            return
        sysinfo.info(t("font.downloading", font_name))
        net.download(
            mirrors.github_urls(spec.url), archive, mirrors, validate=zipfile.is_zipfile
        )
        _extract_fonts(archive, extract_dir, spec)
        font_dir.mkdir(parents=True, exist_ok=True)
        for font in extract_dir.iterdir():
            shutil.copy2(font, font_dir / font.name)
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
        shutil.rmtree(extract_dir, ignore_errors=True)


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
    """Allow local scripts for the current user (needed by Scoop shims and profiles).

    A group policy can pin the scope, in which case this is skipped with a warning
    instead of failing the install.
    """
    result = sysinfo.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force",
        ],
        check=False,
        capture=True,
    )
    if result.returncode != 0:
        sysinfo.warn(t("policy.skipped"))
        return
    sysinfo.success(t("policy.done"))


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


def install_uv_python() -> None:
    sysinfo.run(["uv", "python", "install"])


def install_font_windows(font_name: str, mirrors: Mirrors) -> None:
    spec = FONT_SPECS.get(font_name)
    if spec is None:
        sysinfo.warn(t("font.unknown", font_name))
        return

    font_dir = sysinfo.local_appdata() / "Microsoft" / "Windows" / "Fonts"
    if font_dir.is_dir() and any(
        path.is_file()
        and path.name.startswith(spec.prefix)
        and path.suffix.lower() in FONT_SUFFIXES
        for path in font_dir.iterdir()
    ):
        sysinfo.info(t("font.already", font_name, font_dir))
        return

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as handle:
        archive = Path(handle.name)
    extract_dir = Path(tempfile.mkdtemp(prefix="srp_font_"))
    try:
        sysinfo.info(t("font.downloading", font_name))
        net.download(
            mirrors.github_urls(spec.url), archive, mirrors, validate=zipfile.is_zipfile
        )
        _extract_fonts(archive, extract_dir, spec)
        font_dir.mkdir(parents=True, exist_ok=True)

        try:
            import winreg
        except ImportError:
            winreg = None  # type: ignore[assignment]

        count = 0
        for font in extract_dir.iterdir():
            if font.suffix.lower() not in FONT_SUFFIXES:
                continue
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
            raise RuntimeError(f"No font files for {font_name}")
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
        net.git_clone(url, dest, mirrors)
    theme_link = custom / "themes" / "spaceship.zsh-theme"
    source = custom / "themes" / "spaceship-prompt" / "spaceship.zsh-theme"
    if source.is_file() and not theme_link.exists():
        try:
            theme_link.symlink_to(source)
        except OSError:
            shutil.copy2(source, theme_link)


def configure_windows_environment() -> None:
    # An absolute path: a bare "pwsh.exe" is resolved against the current
    # directory by shells that read SHELL, which breaks e.g. the ProxyCommand
    # an ssh client runs (it uses $SHELL, not the Windows shell).
    pwsh = sysinfo.which("pwsh") or sysinfo.which("pwsh.exe") or "pwsh.exe"
    sysinfo.set_windows_user_env("SHELL", pwsh)
    sysinfo.set_windows_user_env("ZELLIJ_SHELL", pwsh)


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
    "npm_install",
    "configure_pypi_mirror",
    "configure_go_mirror",
    "scoop_install",
    "winget_install",
]
