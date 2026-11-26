#!/bin/sh
# ==============================================================================
# SrP-Dotfiles bootstrap for Linux, macOS and Termux.
#
# This script is the entry point. It checks for Python 3.9+, fetches the
# repository when it is not already present, and hands over to scripts/main.py,
# which installs packages and deploys configs from manifest/*.json.
#
# The script:
#
# - Requires Python 3.9 or newer.
# - Prefers a local checkout, then SRP_DOTFILES_DIR, then ~/.srp-dotfiles.
# - Refreshes the auto-managed checkout on every run, so a cached copy cannot
#   pin an obsolete installer.
# - Uses only the bootstrap mirrors below until the repository is available;
#   manifest/mirror.json takes over afterwards.
# - Refuses to run as root unless SRP_ALLOW_ROOT=1 is set.
# ==============================================================================
#
# Requirements
# ==============================================================================
#
# - Python 3.9 or newer. If it is missing, the script prints the command for
#   the current OS:
#
#     Arch:    sudo pacman -S --needed python
#     Debian:  sudo apt install -y python3
#     Fedora:  sudo dnf install -y python3
#     Termux:  pkg install python
#
# - Run as your normal user, not through sudo. Configs are written to $HOME,
#   and the installer escalates per package-manager command; as root it would
#   deploy into /root.
#
# - Network access to GitHub, the Worker origin, or one of the mirrors.
#
# Usage
# ==============================================================================
#
# Run directly (the script fetches the repository when needed):
#
#   $ curl -fsSL https://dot.srprolin.com | sh -s -- -y
#   $ curl -fsSL https://dot.srprolin.com | sh -s -- -c -y   # configs only
#
# From a local checkout:
#
#   $ ./install.sh                  # confirm each step, install and deploy
#   $ ./install.sh -y               # same, without prompts
#   $ ./install.sh -c               # deploy configs only
#   $ ./install.sh --os arch        # force the target profile
#   $ ./install.sh --dry-run -y     # print the plan only
#
# Command-line options
# ==============================================================================
#
# -c, --config
# Deploy configs only; skip package installation.
#
# -y, --yes
# Answer yes to every step. Required when stdin is not a TTY.
#
# --os <name>
# Force arch, debian, fedora, termux or windows instead of detecting it.
#
# --apps <ids>
# Comma-separated app IDs; "none" selects nothing.
#
# --configs <names>
# Comma-separated config names; "none" selects nothing.
#
# --mirror <profile>
# Select a profile from manifest/mirror.json.
#
# --mirror-<name> <value>
# Override github, npm, pypi, go or scoop; "none" clears the field.
#
# --proxy <url>
# Proxy for downloads. "host:port" is probed for its scheme; "none" clears it.
#
# --catalog
# Print the apps/configs/mirrors catalog as JSON and exit.
#
# --dry-run
# Print the plan without changing the system.
#
# Environment
# ==============================================================================
#
# SRP_REPO_URL        Git repository URL (default: GitHub)
# SRP_GH_PROXY        GitHub proxy prefix tried before the built-in list
# SRP_REPO_TARBALL    Repository archive URL
# SRP_REPO_REF        Branch or tag to fetch (default: main)
# SRP_DOTFILES_DIR    Checkout directory (default: ~/.srp-dotfiles)
# SRP_INSTALL_ORIGIN  Worker base URL (default: https://dot.srprolin.com)
# SRP_ALLOW_ROOT=1    Bypass the root guard (containers and CI only)
# PYTHON              Python interpreter to use (default: python3)
#
# Bootstrap order
# ==============================================================================
#
# This script cannot read manifest/mirror.json yet: it lives inside the
# repository being fetched. It tries, in order:
#
#   1. git clone from SRP_REPO_URL, otherwise GitHub via SRP_GH_PROXY, the
#      built-in mirrors, then direct.
#   2. When git is unavailable or every clone fails: a tarball from
#      <origin>/repo.tar.gz, then SRP_REPO_TARBALL, then codeload.
#   3. If everything fails, exit 1 with the exact commands to retry.
#
# Worker routes
# ==============================================================================
#
# /                     OS-detected script (Unix: install.sh)
# /install.sh           this script (?os=windows / ?os=unix forces the target)
# /install.ps1          PowerShell bootstrap
# /config               checkbox configurator that generates a command
# /api/catalog          apps/configs/mirrors catalog
# /repo.tar.gz          repository tarball (bootstrap fallback)
# /repo.zip             repository zip (bootstrap fallback)
# /health               health probe
#
# ==============================================================================
set -eu

# Never deploy into /root by accident.
if [ "$(id -u)" -eq 0 ] && [ "${SRP_ALLOW_ROOT:-}" != "1" ]; then
    echo "Do not run the installer as root or through sudo." >&2
    echo "It writes configs to \$HOME and escalates per command; as root it would deploy to /root." >&2
    echo "Run it as your normal user. Set SRP_ALLOW_ROOT=1 only in a container or CI." >&2
    exit 1
fi

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1 ||
    ! "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    echo "Python 3.9+ is required." >&2
    echo "Install it first: pacman -S python | apt install python3 | dnf install python3 | pkg install python" >&2
    exit 1
fi

REPO_SLUG="RolinShmily/dotfiles"
REPO_REF="${SRP_REPO_REF:-main}"
GITHUB_URL="https://github.com/$REPO_SLUG.git"
# Mirrors that are reachable before any configuration exists. Keep this in
# sync with the cn profile in manifest/mirror.json.
GH_PREFIXES="${SRP_GH_PROXY:-} https://gh-proxy.com/ https://gh-proxy.org/ https://proxy.269601.xyz/ "
WORKER="${SRP_INSTALL_ORIGIN:-https://dot.srprolin.com}"

# "local" is a checkout the caller already sits in, "explicit" honours
# SRP_DOTFILES_DIR, and "auto" owns ~/.srp-dotfiles and is refreshed on every
# run so a cached copy can never pin an obsolete installer.
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)"
if [ -f "$SELF_DIR/scripts/main.py" ]; then
    REPO="$SELF_DIR"
    REPO_MODE=local
elif [ -f "./scripts/main.py" ]; then
    REPO="$(pwd)"
    REPO_MODE=local
elif [ -n "${SRP_DOTFILES_DIR:-}" ]; then
    REPO="$SRP_DOTFILES_DIR"
    REPO_MODE=explicit
else
    REPO="$HOME/.srp-dotfiles"
    REPO_MODE=auto
fi

# A dead mirror answers in milliseconds when probed, but makes git stall for
# minutes, so probe before cloning through it.
prefix_alive() {
    [ -z "$1" ] && return 0
    command -v curl >/dev/null 2>&1 || return 0
    curl -fsS -o /dev/null --connect-timeout 5 --max-time 8 \
        "$1https://github.com/$REPO_SLUG" 2>/dev/null
}

repo_ref() {
    git -C "$REPO" rev-parse --short HEAD 2>/dev/null || true
}

clone_repo() {
    command -v git >/dev/null 2>&1 || return 1
    if [ -n "${SRP_REPO_URL:-}" ]; then
        set -- "$SRP_REPO_URL"
    else
        set -- $GH_PREFIXES ""
    fi
    for prefix in "$@"; do
        prefix_alive "$prefix" || continue
        rm -rf "$REPO"
        if git clone --depth=1 "$prefix$GITHUB_URL" "$REPO" >/dev/null 2>&1; then
            echo "Repository: $prefix$GITHUB_URL" >&2
            return 0
        fi
    done
    return 1
}

refresh_repo() {
    if [ -d "$REPO/.git" ] && command -v git >/dev/null 2>&1; then
        # Fetch by URL: a cached clone may still point at a mirror that died.
        for url in "$GITHUB_URL" $(for prefix in $GH_PREFIXES; do echo "$prefix$GITHUB_URL"; done); do
            [ -n "$url" ] || continue
            git -C "$REPO" fetch --quiet --depth=1 "$url" "$REPO_REF" >/dev/null 2>&1 || continue
            git -C "$REPO" reset --quiet --hard FETCH_HEAD >/dev/null 2>&1 &&
                git -C "$REPO" remote set-url origin "$GITHUB_URL" >/dev/null 2>&1
            return 0
        done
        return 1
    fi
    download_repo
}

download_repo() {
    command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 1
    tarball="https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/$REPO_REF"
    for url in "$WORKER/repo.tar.gz" "${SRP_REPO_TARBALL:-}" "$tarball" \
        $(for prefix in $GH_PREFIXES; do echo "$prefix$tarball"; done); do
        [ -n "$url" ] || continue
        rm -rf "$REPO"
        mkdir -p "$REPO"
        if curl -fsSL --connect-timeout 20 --max-time 600 "$url" |
            tar -xz --strip-components=1 -C "$REPO" >/dev/null 2>&1 && [ -f "$REPO/scripts/main.py" ]; then
            echo "Repository: $url" >&2
            return 0
        fi
    done
    rm -rf "$REPO"
    return 1
}

if [ ! -f "$REPO/scripts/main.py" ]; then
    if ! clone_repo && ! download_repo; then
        echo "Could not fetch $REPO_SLUG. Try one of:" >&2
        echo "  SRP_GH_PROXY=https://gh-proxy.com/ sh install.sh -y" >&2
        echo "  SRP_REPO_URL=<git mirror url> sh install.sh -y" >&2
        echo "  git clone $GITHUB_URL $REPO" >&2
        exit 1
    fi
elif [ "$REPO_MODE" = auto ]; then
    if ! refresh_repo; then
        echo "Warning: could not refresh $REPO, using the cached copy$( [ -n "$(repo_ref)" ] && echo " at $(repo_ref)")" >&2
    fi
fi

if [ "$REPO_MODE" != local ] && [ -n "$(repo_ref)" ]; then
    echo "Revision: $(repo_ref)" >&2
fi

exec "$PY" "$REPO/scripts/main.py" "$@"
