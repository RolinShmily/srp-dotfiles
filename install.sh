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
# Fetch order: git clone (SRP_REPO_URL, then SRP_GH_PROXY and the built-in
# mirror list, then GitHub directly), then a tarball (Worker /repo.tar.gz,
# codeload). manifest/mirror.json owns the mirrors used after bootstrap.
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
