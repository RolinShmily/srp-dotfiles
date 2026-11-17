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
#   ./install.sh [-a|--all] [-i|--install] [-c|--config] [-y]
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

# --- Repository bootstrap -------------------------------------------------
# The mirror settings live inside the repository, so fetching it cannot rely
# on them. Try the Worker tarball, then GitHub through known proxies, then
# direct GitHub, using git when available and a tarball otherwise.
REPO_SLUG="RolinShmily/srp-dotfiles"
REPO_REF="${SRP_REPO_REF:-main}"
GITHUB_URL="https://github.com/${REPO_SLUG}.git"
WORKER="${SRP_INSTALL_ORIGIN:-https://dot.srprolin.com}"

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)"
if [ -f "$SELF_DIR/scripts/main.py" ]; then
    REPO="$SELF_DIR"
elif [ -f "./scripts/main.py" ]; then
    REPO="$(pwd)"
else
    REPO="${SRP_DOTFILES_DIR:-$HOME/.srp-dotfiles}"
fi

TMP_PREFIXES="$(mktemp 2>/dev/null || echo "/tmp/srp_prefix.$$")"
TMP_URLS="$(mktemp 2>/dev/null || echo "/tmp/srp_urls.$$")"
trap 'rm -f "$TMP_PREFIXES" "$TMP_URLS"' EXIT HUP INT TERM

{
    [ -n "${SRP_GH_PROXY:-}" ] && printf '%s
' "$SRP_GH_PROXY"
    printf '%s
' "https://ghfast.top/" "https://gh-proxy.com/" ""
} > "$TMP_PREFIXES"

clone_repo() {
    _target="$1"
    command -v git >/dev/null 2>&1 || return 1
    if [ -n "${SRP_REPO_URL:-}" ]; then
        printf '%s
' "$SRP_REPO_URL" > "$TMP_URLS"
    else
        while IFS= read -r _prefix; do
            printf '%s%s
' "$_prefix" "$GITHUB_URL"
        done < "$TMP_PREFIXES" > "$TMP_URLS"
    fi
    while IFS= read -r _url; do
        rm -rf "$_target"
        if git clone --depth=1 "$_url" "$_target" >/dev/null 2>&1; then
            printf 'Repository: %s
' "$_url" >&2
            return 0
        fi
    done < "$TMP_URLS"
    return 1
}

download_repo() {
    _target="$1"
    command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 1
    {
        printf '%s/repo.tar.gz
' "$WORKER"
        [ -n "${SRP_REPO_TARBALL:-}" ] && printf '%s
' "$SRP_REPO_TARBALL"
        printf 'https://codeload.github.com/%s/tar.gz/refs/heads/%s
' "$REPO_SLUG" "$REPO_REF"
        while IFS= read -r _prefix; do
            [ -n "$_prefix" ] && printf '%shttps://codeload.github.com/%s/tar.gz/refs/heads/%s
'                 "$_prefix" "$REPO_SLUG" "$REPO_REF"
        done < "$TMP_PREFIXES"
    } > "$TMP_URLS"
    while IFS= read -r _url; do
        rm -rf "$_target"
        mkdir -p "$_target"
        if curl -fsSL --connect-timeout 20 --max-time 600 "$_url" |
            tar -xz --strip-components=1 -C "$_target" >/dev/null 2>&1; then
            if [ -f "$_target/scripts/main.py" ]; then
                printf 'Repository: %s
' "$_url" >&2
                return 0
            fi
        fi
    done < "$TMP_URLS"
    rm -rf "$_target"
    return 1
}

if [ ! -f "$REPO/scripts/main.py" ]; then
    if ! clone_repo "$REPO" && ! download_repo "$REPO"; then
        echo "Could not fetch ${REPO_SLUG}." >&2
        echo "Try one of:" >&2
        echo "  SRP_REPO_URL=<git mirror url> sh install.sh -a -y" >&2
        echo "  SRP_GH_PROXY=https://ghfast.top/ sh install.sh -a -y" >&2
        echo "  git clone ${GITHUB_URL} ${REPO}" >&2
        exit 1
    fi
fi

rm -f "$TMP_PREFIXES" "$TMP_URLS"
exec "$PY" "$REPO/scripts/main.py" "$@"
