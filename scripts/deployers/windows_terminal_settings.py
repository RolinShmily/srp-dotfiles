"""Windows Terminal partial-overwrite deployment (JSONC aware)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from lib import platform_info as sysinfo
from lib.context import Context
from lib.i18n import t


def _strip_comments(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    in_line = False
    in_block = False
    index = 0
    while index < len(text):
        char = text[index]

        if in_line:
            if char in "\r\n":
                in_line = False
                out.append(char)
            else:
                out.append(" ")
            index += 1
            continue

        if in_block:
            if char == "*" and index + 1 < len(text) and text[index + 1] == "/":
                out.append("  ")
                index += 2
                in_block = False
            else:
                out.append(char if char in "\r\n" else " ")
                index += 1
            continue

        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            out.append(char)
        elif char == "/" and index + 1 < len(text) and text[index + 1] == "/":
            out.append("  ")
            index += 2
            in_line = True
            continue
        elif char == "/" and index + 1 < len(text) and text[index + 1] == "*":
            out.append("  ")
            index += 2
            in_block = True
            continue
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    index = 0
    while index < len(text):
        char = text[index]
        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            out.append(char)
            index += 1
            continue
        if char == ",":
            ahead = index + 1
            while ahead < len(text) and text[ahead].isspace():
                ahead += 1
            if ahead < len(text) and text[ahead] in "}]":
                index = ahead
                continue
        out.append(char)
        index += 1
    return "".join(out)


def _parse_jsonc(text: str) -> dict:
    data = json.loads(_strip_trailing_commas(_strip_comments(text)))
    if not isinstance(data, dict):
        raise ValueError("settings root must be an object")
    return data


def _merge(target: dict, source: dict, path: str = "") -> None:
    for key, value in source.items():
        if path == "" and key == "defaultProfile":
            continue
        if path == "profiles" and key == "list":
            continue
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            child = f"{path}.{key}" if path else key
            _merge(target[key], value, child)
        else:
            target[key] = value


def run(ctx: Context) -> None:
    source = ctx.repo / "configs" / "windows-terminal" / "settings.json"
    target = (
        sysinfo.local_appdata()
        / "Packages"
        / "Microsoft.WindowsTerminal_8wekyb3d8bbwe"
        / "LocalState"
        / "settings.json"
    )
    if not source.is_file():
        raise FileNotFoundError(t("wt.template_missing", source))

    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copy2(source, target)
        sysinfo.success(t("wt.created", target))
        return

    merged = _parse_jsonc(target.read_text(encoding="utf-8-sig"))
    template = _parse_jsonc(source.read_text(encoding="utf-8-sig"))
    _merge(merged, template)

    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps(merged, indent=4, ensure_ascii=False) + "\n", encoding="utf-8", newline="\r\n")
    temp.replace(target)
    sysinfo.success(t("wt.merged"))
