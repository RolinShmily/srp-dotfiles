#!/bin/sh
# SrP-Dotfiles installer bootstrap.
# Checks for Python 3.9+ and hands over to scripts/main.py.
#
# Python is the only hard requirement:
#   Arch:    sudo pacman -S --needed python
#   Debian:  sudo apt install -y python3
#   Fedora:  sudo dnf install -y python3
#   Termux:  pkg install python
#   Windows: winget install Python.Python.3.12
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -a -y
#   ./install.sh [-a|--all] [-i|--install] [-c|--config] [-y] [-f]
set -eu

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
    echo "Python 3.9+ is required but '$PY' was not found." >&2
    echo "Install it first: pacman -S python | apt install python3 | dnf install python3 | pkg install python" >&2
    exit 1
fi
if ! "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
    echo "Python 3.9+ is required; found: $("$PY" -c 'import sys; print(sys.version.split()[0])')" >&2
    exit 1
fi

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)"
if [ -f "$SELF_DIR/scripts/main.py" ]; then
    REPO="$SELF_DIR"
elif [ -f "./scripts/main.py" ]; then
    REPO="$(pwd)"
else
    REPO="${SRP_DOTFILES_DIR:-$HOME/.srp-dotfiles}"
    if [ ! -f "$REPO/scripts/main.py" ]; then
        if command -v git >/dev/null 2>&1; then
            git clone --depth=1 "${SRP_REPO_URL:-https://github.com/RolinShmily/srp-dotfiles.git}" "$REPO"
        elif command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
            mkdir -p "$REPO"
            curl -fsSL "https://codeload.github.com/RolinShmily/srp-dotfiles/tar.gz/refs/heads/main" |
                tar -xz --strip-components=1 -C "$REPO"
        else
            echo "git (or curl+tar) is required to fetch the repository" >&2
            exit 1
        fi
    fi
fi

exec "$PY" "$REPO/scripts/main.py" "$@"
