#!/bin/sh
# SrP-Dotfiles bootstrap: check Python 3.9+, fetch the repository, run scripts/main.py.
#
# Python is the only requirement:
#   Arch:    sudo pacman -S --needed python
#   Debian:  sudo apt install -y python3
#   Fedora:  sudo dnf install -y python3
#   Termux:  pkg install python
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -y
#   ./install.sh [-c|--config] [-y]
#
# Fetch order: git clone (SRP_REPO_URL, then GitHub via SRP_GH_PROXY, ghfast.top,
# gh-proxy.com, direct), then a tarball (Worker /repo.tar.gz, codeload).
set -eu

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1 ||
    ! "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    echo "Python 3.9+ is required." >&2
    echo "Install it first: pacman -S python | apt install python3 | dnf install python3 | pkg install python" >&2
    exit 1
fi

REPO_SLUG="RolinShmily/srp-dotfiles"
REPO_REF="${SRP_REPO_REF:-main}"
GITHUB_URL="https://github.com/$REPO_SLUG.git"
WORKER="${SRP_INSTALL_ORIGIN:-https://dot.srprolin.com}"

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)"
if [ -f "$SELF_DIR/scripts/main.py" ]; then
    REPO="$SELF_DIR"
elif [ -f "./scripts/main.py" ]; then
    REPO="$(pwd)"
else
    REPO="${SRP_DOTFILES_DIR:-$HOME/.srp-dotfiles}"
fi

clone_repo() {
    command -v git >/dev/null 2>&1 || return 1
    if [ -n "${SRP_REPO_URL:-}" ]; then
        set -- "$SRP_REPO_URL"
    else
        set -- "${SRP_GH_PROXY:-}" "https://ghfast.top/" "https://gh-proxy.com/" ""
    fi
    for prefix in "$@"; do
        rm -rf "$REPO"
        if git clone --depth=1 "$prefix$GITHUB_URL" "$REPO" >/dev/null 2>&1; then
            echo "Repository: $prefix$GITHUB_URL" >&2
            return 0
        fi
    done
    return 1
}

download_repo() {
    command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 1
    for url in \
        "$WORKER/repo.tar.gz" \
        "${SRP_REPO_TARBALL:-}" \
        "https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/$REPO_REF" \
        "${SRP_GH_PROXY:+${SRP_GH_PROXY}https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/$REPO_REF}" \
        "https://ghfast.top/https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/$REPO_REF" \
        "https://gh-proxy.com/https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/$REPO_REF"; do
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
        echo "  SRP_GH_PROXY=https://ghfast.top/ sh install.sh -y" >&2
        echo "  SRP_REPO_URL=<git mirror url> sh install.sh -y" >&2
        echo "  git clone $GITHUB_URL $REPO" >&2
        exit 1
    fi
fi

exec "$PY" "$REPO/scripts/main.py" "$@"
