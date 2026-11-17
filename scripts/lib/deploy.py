"""Deployment verbs: copy, with backup semantics."""

from __future__ import annotations

import os
import shutil
import stat
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


def _backup_existing(dest: Path, backup_dir: Path, force: bool) -> None:
    """Keep the previous content before overwriting, unless --force is used."""
    if not dest.exists():
        return
    if force:
        sysinfo.warn(t("deploy.force_delete", dest))
        return

    backup = _backup_path(dest, backup_dir)
    backup.parent.mkdir(parents=True, exist_ok=True)

    if dest.is_file() and not dest.is_symlink():
        # Copy instead of move: Scoop persist files are hard links and must
        # keep their inode, otherwise the app keeps reading the old content.
        try:
            shutil.copy2(dest, backup)
            sysinfo.warn(t("deploy.backup", dest, backup))
        except OSError:
            pass
        return

    try:
        shutil.move(str(dest), str(backup))
        sysinfo.warn(t("deploy.backup", dest, backup))
    except OSError:
        pass


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

    # Legacy symlinks/junctions from older versions are dropped, not backed up.
    if _is_link(dest):
        _remove(dest)

    if src.is_file() and dest.is_file():
        _backup_existing(dest, backup_dir, force)
        shutil.copyfile(src, dest)
        sysinfo.success(t("deploy.overwrite_file", dest))
        return

    _backup_existing(dest, backup_dir, force)

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
