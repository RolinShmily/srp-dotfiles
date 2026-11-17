"""Deployment verbs: link / copy / copy-example, with backup semantics."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

from . import platform_info as sysinfo
from .i18n import t


def _is_reparse(path: Path) -> bool:
    try:
        attrs = os.lstat(path).st_file_attributes  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        return False
    return bool(attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _is_link(path: Path) -> bool:
    return path.is_symlink() or _is_reparse(path)


def _remove(path: Path) -> None:
    if not path.exists() and not _is_link(path):
        return
    if _is_link(path):
        if path.is_dir():
            path.rmdir()
        else:
            path.unlink(missing_ok=True)
    elif path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _backup_path(dest: Path, backup_dir: Path) -> Path:
    try:
        rel = dest.relative_to(sysinfo.home())
    except ValueError:
        rel = Path(dest.name)
    return backup_dir / rel


def _clear_destination(src: Path, dest: Path, backup_dir: Path, force: bool) -> bool:
    if _is_link(dest):
        try:
            same = dest.resolve() == src.resolve()
        except OSError:
            same = False
        if same:
            return False
        sysinfo.warn(f"Replacing link: {dest}")
        _remove(dest)
        return True

    if dest.exists():
        if force:
            sysinfo.warn(t("deploy.force_delete", dest))
            _remove(dest)
            return True
        backup = _backup_path(dest, backup_dir)
        backup.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(dest), str(backup))
            sysinfo.warn(t("deploy.backup", dest, backup))
            return True
        except OSError:
            _remove(dest)
    return True


def _link_windows(src: Path, dest: Path) -> None:
    is_dir = src.is_dir()
    try:
        os.symlink(src, dest, target_is_directory=is_dir)
        sysinfo.success(t("deploy.linked", dest, src))
        return
    except OSError:
        pass

    if is_dir:
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(dest), str(src)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            sysinfo.success(t("deploy.link_fallback", dest, src))
            return
    else:
        try:
            os.link(src, dest)
            sysinfo.success(t("deploy.link_fallback", dest, src))
            return
        except OSError:
            pass

    sysinfo.warn(t("deploy.copy_fallback", dest))
    if is_dir:
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    sysinfo.success(t("deploy.copied", dest))


def link_item(src: Path, dest: Path, backup_dir: Path, exclude: list[str], force: bool) -> None:
    if not src.exists():
        sysinfo.warn(t("deploy.source_missing", dest.name, src))
        return

    if src.is_dir() and exclude:
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            if child.name in exclude:
                sysinfo.info(t("deploy.exclude", child.name))
                continue
            link_item(child, dest / child.name, backup_dir, [], force)
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    if not _clear_destination(src, dest, backup_dir, force):
        sysinfo.info(t("deploy.link_correct", dest))
        return

    if sysinfo.IS_WINDOWS:
        _link_windows(src, dest)
    else:
        os.symlink(src, dest)
        sysinfo.success(t("deploy.linked", dest, src))


def copy_item(
    src: Path,
    dest: Path,
    backup_dir: Path,
    force: bool,
    exclude: list[str] | None = None,
    if_missing: bool = False,
) -> None:
    exclude = exclude or []
    if not src.exists():
        sysinfo.warn(t("deploy.source_missing", dest.name, src))
        return

    if if_missing and dest.exists() and not force:
        sysinfo.info(t("deploy.if_missing", dest))
        return

    dest.parent.mkdir(parents=True, exist_ok=True)

    if _is_link(dest):
        _remove(dest)

    if src.is_file() and dest.is_file():
        shutil.copyfile(src, dest)
        sysinfo.success(t("deploy.overwrite_file", dest))
        return

    if src.is_dir() and exclude:
        _remove(dest)
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            if child.name in exclude:
                sysinfo.info(t("deploy.exclude", child.name))
                continue
            copy_item(child, dest / child.name, backup_dir, force)
        sysinfo.success(t("deploy.overwrite", dest))
        return

    _remove(dest)
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    sysinfo.success(t("deploy.overwrite", dest))


def copy_example_item(
    src: Path,
    dest: Path,
    backup_dir: Path,
    force: bool,
    if_missing: bool = False,
) -> None:
    exists = dest.exists() or _is_link(dest)
    example = Path(str(dest) + ".example") if exists else dest
    if exists:
        sysinfo.info(t("deploy.example_existing", example))
    else:
        sysinfo.info(t("deploy.example_missing", dest))
    copy_item(src, example, backup_dir, force, if_missing=if_missing)
