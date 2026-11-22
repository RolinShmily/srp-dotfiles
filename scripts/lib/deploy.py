"""Deployment verbs: copy, with backup semantics."""

from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

from . import platform_info as sysinfo
from .messages import t


def _is_reparse(path: Path) -> bool:
    try:
        attrs = os.lstat(path).st_file_attributes  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        return False
    return bool(attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _is_link(path: Path) -> bool:
    return path.is_symlink() or _is_reparse(path)


def _same_file(a: Path, b: Path) -> bool:
    try:
        return a.samefile(b)
    except OSError:
        return False


def _same_entry(a: Path, b: Path) -> bool:
    """True when both paths name one directory entry, not a hard-link twin."""
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def _remove(path: Path) -> None:
    if not path.exists() and not _is_link(path):
        return
    if _is_link(path):
        # Unlink links directly: rmdir() on a symlink to a directory raises
        # ENOTDIR on POSIX, which is how legacy link deployments used to fail
        # when the copy verb took over.
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


def _backup_existing(dest: Path, backup_dir: Path) -> None:
    """Keep the previous content before overwriting it."""
    if not dest.exists():
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


def _ensure_dir(path: Path) -> None:
    """Create path, clearing links that would make later writes fail.

    ``mkdir(parents=True, exist_ok=True)`` accepts a dangling symlink or a plain
    file sitting where a directory belongs, then every copy into it dies with
    ENOTDIR. Walk the chain first and replace those placeholders.
    """
    if path.is_dir():
        return
    if path.parent == path:
        return
    _ensure_dir(path.parent)
    if _is_link(path):
        # Dangling link, or a link to a file: nothing of value to keep.
        _remove(path)
    elif path.exists():
        raise RuntimeError(t("deploy.blocked", path))
    try:
        path.mkdir()
    except FileExistsError:
        if not path.is_dir():
            raise


def copy_item(
    src: Path,
    dest: Path,
    backup_dir: Path,
    exclude: list[str] | None = None,
    if_missing: bool = False,
) -> None:
    exclude = exclude or []
    if not src.exists():
        sysinfo.warn(t("deploy.source_missing", dest.name, src))
        return

    if if_missing and dest.exists():
        sysinfo.info(t("deploy.if_missing", dest))
        return

    _ensure_dir(dest.parent)

    # Legacy symlinks/junctions from older versions are dropped, not backed up.
    if _is_link(dest):
        _remove(dest)

    # The old installer also linked files in: New-Item -ItemType HardLink.
    # copyfile()/copy2() refuse to write over the same inode, so drop the link
    # first; the source keeps the inode and the copy breaks the link. When the
    # target *is* the source entry, there is nothing to deploy.
    if src.is_file() and dest.is_file() and _same_file(src, dest):
        if _same_entry(src, dest):
            sysinfo.info(t("deploy.same_file", dest))
            return
        _remove(dest)

    if src.is_file() and dest.is_file():
        _backup_existing(dest, backup_dir)
        shutil.copyfile(src, dest)
        sysinfo.success(t("deploy.overwrite_file", dest))
        return

    _backup_existing(dest, backup_dir)

    if src.is_dir() and exclude:
        _remove(dest)
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            if child.name in exclude:
                sysinfo.info(t("deploy.exclude", child.name))
                continue
            copy_item(child, dest / child.name, backup_dir)
        sysinfo.success(t("deploy.overwrite", dest))
        return

    _remove(dest)
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    sysinfo.success(t("deploy.overwrite", dest))
