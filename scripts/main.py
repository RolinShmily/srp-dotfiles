#!/usr/bin/env python3
"""SrP-Dotfiles unified installer and deployer.

Requires Python 3.9 or newer. On a bare machine install it first:
  Arch:    sudo pacman -S --needed python
  Debian:  sudo apt install -y python3
  Fedora:  sudo dnf install -y python3
  Termux:  pkg install python
  Windows: winget install Python.Python.3.12

Usage:
  python scripts/main.py [-a|--all] [-i|--install] [-c|--config] [-y] [-f]
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

from lib import catalog  # noqa: E402
from lib import deploy  # noqa: E402
from lib import i18n  # noqa: E402
from lib import installers  # noqa: E402
from lib import manifest as manifest_lib  # noqa: E402
from lib import platform_info as sysinfo  # noqa: E402
from lib.context import Context  # noqa: E402
from lib.i18n import t  # noqa: E402
from lib.runner import Runner  # noqa: E402

PROFILES = ("arch", "debian", "fedora", "termux", "windows")


def print_help() -> None:
    print(t("help.title"))
    print(t("help.usage"))
    print()
    print(t("help.commands"))
    print()
    print(t("help.options"))
    print()
    print(t("help.examples"))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("-a", "--all", dest="do_all", action="store_true")
    actions.add_argument("-i", "--install", dest="do_install", action="store_true")
    actions.add_argument("-c", "--config", dest="do_config", action="store_true")
    parser.add_argument("-y", "--yes", action="store_true")
    parser.add_argument("-f", "--force", "-Force", dest="force", action="store_true")
    parser.add_argument("--apps", default=None)
    parser.add_argument("--configs", default=None)
    for name in ("github", "npm", "pypi", "go", "scoop"):
        parser.add_argument(
            f"--mirror-{name}", dest=f"mirror_{name.replace('-', '_')}", default=None
        )
    parser.add_argument("--proxy", default=None)
    parser.add_argument("--mirror-profile", dest="mirror_profile", default=None)
    parser.add_argument("--catalog", action="store_true")
    parser.add_argument("--os", dest="os_name", default="")
    parser.add_argument("--lang", "-Lang", dest="lang", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("-h", "--help", action="store_true")
    return parser.parse_args(argv)


def apply_mirror_env(mirrors: manifest_lib.Mirrors) -> None:
    sysinfo.apply_proxy_env(mirrors.proxy)
    if mirrors.npm_registry:
        os.environ["npm_config_registry"] = mirrors.npm_registry
    if mirrors.pypi_indexes:
        index = mirrors.pypi_indexes[0]
        extras = " ".join(mirrors.pypi_indexes[1:])
        os.environ["PIP_INDEX_URL"] = index
        os.environ["UV_INDEX_URL"] = index
        os.environ["UV_DEFAULT_INDEX"] = index
        if extras:
            os.environ["PIP_EXTRA_INDEX_URL"] = extras
            os.environ["UV_EXTRA_INDEX_URL"] = extras
    if mirrors.go_proxy:
        os.environ["GOPROXY"] = mirrors.go_proxy


def override_list(value: str | None, default: list[str]) -> list[str]:
    if value is None:
        return default
    if value.strip().lower() == "none":
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def override_text(value: str | None, default: str) -> str:
    if value is None:
        return default
    if value.strip().lower() == "none":
        return ""
    return value.strip()


def apply_mirror_overrides(
    mirrors: manifest_lib.Mirrors, overrides: dict[str, str | None]
) -> manifest_lib.Mirrors:
    return manifest_lib.Mirrors(
        profile=mirrors.profile,
        proxy=override_text(overrides.get("proxy"), mirrors.proxy),
        github_proxies=override_list(overrides.get("github"), mirrors.github_proxies),
        npm_registry=override_text(overrides.get("npm"), mirrors.npm_registry),
        pypi_indexes=override_list(overrides.get("pypi"), mirrors.pypi_indexes),
        go_proxy=override_text(overrides.get("go"), mirrors.go_proxy),
        scoop_buckets=override_list(overrides.get("scoop"), mirrors.scoop_buckets),
    )


def print_mirror_status(mirrors: manifest_lib.Mirrors) -> None:
    if not (
        mirrors.github_proxies
        or mirrors.npm_registry
        or mirrors.pypi_indexes
        or mirrors.go_proxy
        or mirrors.proxy
    ):
        return
    sysinfo.info(
        t(
            "mirror.status",
            mirrors.profile or "-",
            mirrors.github_proxy or "-",
            mirrors.npm_registry or "-",
            mirrors.proxy or "-",
        )
    )


def load(
    repo: Path, os_name: str, mirror_profile: str = ""
) -> tuple[manifest_lib.Manifest, manifest_lib.Mirrors] | None:
    try:
        data = manifest_lib.Manifest(repo, os_name)
        mirrors = manifest_lib.load_mirrors(repo, mirror_profile)
    except manifest_lib.ManifestError as exc:
        sysinfo.error(str(exc))
        return None
    return data, mirrors


def app_names(apps: list[dict], selected: set[str], prefix: str) -> list[str]:
    return [
        app["name"]
        for app in apps
        if app["id"] in selected and app["id"].startswith(prefix)
    ]


def run_install(
    runner: Runner,
    os_name: str,
    data: manifest_lib.Manifest,
    mirrors: manifest_lib.Mirrors,
    catalog_data: dict,
    selected_apps: set[str],
) -> None:
    runner.stage(t("install.title", os_name))
    print_mirror_status(mirrors)

    apps = catalog_data["apps"]
    if os_name == "windows":
        winget = app_names(apps, selected_apps, "winget:")
        scoop = app_names(apps, selected_apps, "scoop:")
        fonts = app_names(apps, selected_apps, "font:")

        if selected_apps and (winget or scoop or fonts):
            runner.run(t("step.policy"), installers.set_execution_policy, core=True)
        if winget:
            for package in winget:
                runner.run(
                    t("step.winget", package),
                    lambda pkg=package: installers.winget_install(pkg),
                    core=True,
                )
        if scoop or fonts:
            runner.run(t("step.scoop_setup"), lambda: installers.install_scoop(mirrors), core=True)
            if mirrors.scoop_buckets:
                runner.run(t("step.buckets"), lambda: installers.configure_scoop_buckets(mirrors), core=False)

        if "aria2" in scoop:
            runner.run(t("step.aria2"), lambda: installers.configure_aria2(data), core=False)
        for package in scoop:
            if package == "aria2":
                continue
            runner.run(
                t("step.scoop_pkg", package),
                lambda pkg=package: installers.scoop_install(pkg),
                core=True,
            )
        for font in fonts:
            spec = installers.FONT_SPECS.get(font)
            if spec and spec.scoop_package and not (mirrors.github_proxy or mirrors.proxy):
                runner.run(
                    t("step.scoop_pkg", spec.scoop_package),
                    lambda pkg=spec.scoop_package: installers.scoop_install(pkg),
                    core=False,
                )
            else:
                runner.run(
                    t("step.font", font),
                    lambda name=font: installers.install_font_windows(name, mirrors),
                    core=False,
                )
        if "uv" in scoop:
            runner.run(t("step.uv_python"), installers.install_uv_python, core=False)
    else:
        packages = app_names(apps, selected_apps, "pkg:")
        if packages:
            for repo_name in data.array("copr"):
                runner.run(
                    t("step.copr", repo_name),
                    lambda name=str(repo_name): installers.enable_copr(name),
                    core=True,
                )
            package_manager = data.value("packageManager")
            runner.run(
                t("step.system_packages", package_manager, len(packages)),
                lambda: installers.install_system_packages(os_name, package_manager, packages),
                core=True,
            )
        if "zsh" in packages:
            runner.run(t("step.shell"), lambda: installers.set_default_shell(os_name), core=True)
            runner.run(t("step.omz"), lambda: installers.install_omz(mirrors), core=False)
        for font in app_names(apps, selected_apps, "font:"):
            runner.run(
                t("step.font", font),
                lambda name=font: installers.install_font(os_name, name, mirrors),
                core=False,
            )

    for package in app_names(apps, selected_apps, "npm:"):
        runner.run(
            t("step.npm", package),
            lambda pkg=package: installers.npm_install(os_name, pkg, mirrors),
            core=False,
        )
    for item in app_names(apps, selected_apps, "skill:"):
        runner.run(
            t("step.skill", item),
            lambda value=item: installers.install_skill(value),
            core=False,
        )

    if mirrors.pypi_indexes:
        runner.run(t("step.pypi_mirror"), lambda: installers.configure_pypi_mirror(mirrors), core=False)
    if mirrors.go_proxy:
        runner.run(t("step.go_mirror"), lambda: installers.configure_go_mirror(mirrors), core=False)

    sysinfo.success(t("install.done"))


def dispatch(entry: manifest_lib.ConfigEntry, ctx: Context, runner: Runner) -> None:
    if entry.when:
        when_path = sysinfo.expand_path(entry.when)
        if not when_path.exists():
            sysinfo.info(t("config.condition", entry.name, entry.when))
            return

    if entry.method == "custom":
        module_name = entry.name.replace("-", "_")
        try:
            module = importlib.import_module(f"deployers.{module_name}")
        except ModuleNotFoundError:
            sysinfo.error(t("config.custom_missing", entry.name, module_name))
            return
        runner.run(t("config.custom", entry.name), lambda: module.run(ctx), core=True)
        return

    if entry.method not in ("link", "copy"):
        sysinfo.warn(t("config.method_unknown", entry.name, entry.method))
        return

    source = ctx.repo / entry.source
    if not source.exists():
        sysinfo.warn(t("config.source_missing", entry.name, entry.source))
        return
    if not entry.targets:
        sysinfo.warn(t("config.target_missing", entry.name))
        return

    for raw_target in entry.targets:
        target = sysinfo.expand_path(raw_target)
        if entry.method == "link":
            runner.run(
                t("step.link", entry.name, raw_target),
                lambda s=source, d=target: deploy.link_item(
                    s, d, ctx.backup_dir, entry.exclude, ctx.force
                ),
                core=True,
            )
        elif entry.source.endswith(".example"):
            runner.run(
                t("step.copy_example", entry.name, raw_target),
                lambda s=source, d=target: deploy.copy_example_item(
                    s, d, ctx.backup_dir, ctx.force, if_missing=entry.if_missing
                ),
                core=True,
            )
        else:
            runner.run(
                t("step.copy", entry.name, raw_target),
                lambda s=source, d=target: deploy.copy_item(
                    s, d, ctx.backup_dir, ctx.force, exclude=entry.exclude, if_missing=entry.if_missing
                ),
                core=True,
            )


def run_config(
    runner: Runner,
    repo: Path,
    os_name: str,
    data: manifest_lib.Manifest,
    mirrors: manifest_lib.Mirrors,
    force: bool,
    selected_configs: set[str],
) -> None:
    runner.stage(t("config.title", os_name))
    print_mirror_status(mirrors)

    backup_dir = sysinfo.home() / f".dotfiles_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    if not runner.dry_run:
        sysinfo.info(t("config.backup", backup_dir))

    if os_name == "windows":
        runner.run(t("step.env"), installers.configure_windows_environment, core=True)
        runner.run(t("step.git"), installers.configure_git, core=False)
    elif "zshrc" in selected_configs:
        runner.run(t("step.omz_plugins"), lambda: installers.setup_omz_plugins(mirrors), core=True)

    ctx = Context(
        repo=repo,
        os_name=os_name,
        manifest=data,
        mirrors=mirrors,
        backup_dir=backup_dir,
        force=force,
        runner=runner,
    )
    for entry in data.configs():
        if entry.name not in selected_configs:
            continue
        dispatch(entry, ctx, runner)
    sysinfo.success(t("config.done"))


def run_action(
    action: str,
    repo: Path,
    os_name: str,
    assume_yes: bool,
    force: bool,
    dry_run: bool,
    apps_spec: str | None = None,
    configs_spec: str | None = None,
    mirror_overrides: dict[str, str | None] | None = None,
    mirror_profile: str | None = None,
) -> int:
    loaded = load(repo, os_name, mirror_profile or "")
    if loaded is None:
        return 1
    data, raw_mirrors = loaded
    catalog_data = catalog.build_catalog(data, raw_mirrors)

    try:
        selected_apps = catalog.resolve(apps_spec, [app["id"] for app in catalog_data["apps"]])
        selected_configs = catalog.resolve(
            configs_spec, [entry["id"] for entry in catalog_data["configs"]]
        )
    except catalog.SelectionError as exc:
        sysinfo.error(t("selection.unknown", exc.unknown or "-"))
        sysinfo.info(t("selection.available", ", ".join(exc.available)))
        return 2

    mirrors = apply_mirror_overrides(raw_mirrors, mirror_overrides or {})
    apply_mirror_env(mirrors)

    runner = Runner(assume_yes=assume_yes, dry_run=dry_run)
    try:
        if action in ("all", "install"):
            run_install(
                runner,
                os_name,
                data,
                mirrors,
                catalog_data,
                selected_apps,
            )
        if action in ("all", "config"):
            run_config(runner, repo, os_name, data, mirrors, force, selected_configs)
    finally:
        runner.report(os_name)
    return 0


def menu(
    repo: Path,
    os_name: str,
    assume_yes: bool,
    force: bool,
    dry_run: bool,
    apps_spec: str | None,
    configs_spec: str | None,
    mirror_overrides: dict[str, str | None] | None,
    mirror_profile: str | None,
) -> int:
    while True:
        print()
        print("=" * 60)
        print(t("menu.title"))
        print(t("menu.target", os_name, repo))
        print("=" * 60)
        print(t("menu.choose"))
        print(t("menu.all"))
        print(t("menu.install"))
        print(t("menu.config"))
        print(t("menu.language", "中文" if i18n.LANG == "zh" else "en"))
        print(t("menu.exit"))
        try:
            choice = input(t("menu.choice")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if choice in ("1", ""):
            run_action("all", repo, os_name, assume_yes, force, dry_run, apps_spec, configs_spec, mirror_overrides, mirror_profile)
        elif choice == "2":
            run_action("install", repo, os_name, assume_yes, force, dry_run, apps_spec, configs_spec, mirror_overrides, mirror_profile)
        elif choice == "3":
            run_action("config", repo, os_name, assume_yes, force, dry_run, apps_spec, configs_spec, mirror_overrides, mirror_profile)
        elif choice == "4":
            i18n.set_language("en" if i18n.LANG == "zh" else "zh")
        elif choice == "0":
            print(t("menu.done"))
            return 0
        else:
            sysinfo.warn(t("menu.invalid", choice))


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    language = args.lang or os.environ.get("DF_LANG") or os.environ.get("SRP_LANG") or "en"
    i18n.set_language(language)

    mirror_overrides = {
        name: getattr(args, f"mirror_{name.replace('-', '_')}")
        for name in ("github", "npm", "pypi", "go", "scoop")
    }
    mirror_overrides["proxy"] = args.proxy

    if args.help:
        print_help()
        return 0

    os_name = args.os_name or sysinfo.detect_os()
    if os_name not in PROFILES:
        sysinfo.error(f"Unsupported target: {os_name} ({', '.join(PROFILES)})")
        return 2

    if args.catalog:
        loaded = load(REPO_DIR, os_name, args.mirror_profile or "")
        if loaded is None:
            return 1
        default_profile, profiles = manifest_lib.load_mirror_profiles(REPO_DIR)
        fallback = profiles.get(default_profile) or manifest_lib.Mirrors()
        print(
            json.dumps(
                catalog.build_catalog(loaded[0], fallback, profiles, default_profile),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.do_all:
        action = "all"
    elif args.do_install:
        action = "install"
    elif args.do_config:
        action = "config"
    else:
        action = "launch"
    if action == "launch":
        if not sys.stdin.isatty():
            print_help()
            return 0
        return menu(
            REPO_DIR,
            os_name,
            args.yes,
            args.force,
            args.dry_run,
            args.apps,
            args.configs,
            mirror_overrides,
            args.mirror_profile,
        )

    if not sys.stdin.isatty() and not args.yes and not args.dry_run:
        sysinfo.error(t("error.no_tty"))
        return 2

    if args.dry_run:
        sysinfo.set_dry_run(True)
    return run_action(
        action,
        REPO_DIR,
        os_name,
        args.yes,
        args.force,
        args.dry_run,
        args.apps,
        args.configs,
        mirror_overrides,
        args.mirror_profile,
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        print()
        sysinfo.error(t("step.aborted"))
        raise SystemExit(130) from None
