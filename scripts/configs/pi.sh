#!/usr/bin/env bash
# scripts/configs/pi.sh — Pi 配置初始化（Unix）。
#
# Pi 的本地 resources 直接指向仓库绝对路径，不复制、不软链接：
#   manifest.<os>.piResources -> pi-inject-resources.js -> settings.json
# 外部 skills 仍由安装阶段的 skillsAdd 负责安装到 ~/.pi/agent/skills。
#
# 入口调用时通过环境变量传入 DOTFILES_DIR / BACKUP_DIR / FORCE / PI_MANIFEST_OS。

set -e

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DOTFILES_DIR:=$(dirname "$(dirname "$SELF_DIR")")}"
: "${BACKUP_DIR:=$HOME/.dotfiles_backup/manual}"
: "${FORCE:=0}"
: "${PI_MANIFEST_OS:=arch}"

# 独立运行时补上日志函数
command -v log_info    >/dev/null || log_info()    { echo "[INFO] $1"; }
command -v log_warn    >/dev/null || log_warn()    { echo "[WARN] $1"; }
command -v log_success >/dev/null || log_success() { echo "[OK]   $1"; }

source "$DOTFILES_DIR/scripts/lib/deploy.sh"

PI_SRC="$DOTFILES_DIR/pi"
PI_DEST="$HOME/.pi/agent"
INJECT_JS="$DOTFILES_DIR/scripts/lib/pi-inject-resources.js"

if [ ! -d "$PI_SRC" ]; then
    log_warn "$(i18n pi.no_source "$PI_SRC")"
    exit 1
fi

mkdir -p "$PI_DEST"

# ---------- 1. 全局规范 ----------
[ -f "$PI_SRC/AGENTS.md" ] && copy_item "$PI_SRC/AGENTS.md" "$PI_DEST/AGENTS.md"

# ---------- 2. settings.json：一次性创建并注入完整资源集合 ----------
if [ -f "$PI_SRC/settings.json.example" ]; then
    settings_target="$PI_DEST/settings.json"
    copy_item "$PI_SRC/settings.json.example" "$settings_target"
    node "$INJECT_JS" "$settings_target" "$PI_MANIFEST_OS"
fi

# ---------- 3. Pi 自己维护的 JSON 配置 ----------
# mcp.json / keybindings.json 已存在时保留，模板旁存为 .example。
if [ -f "$PI_SRC/mcp.json.example" ]; then
    copy_example_item "$PI_SRC/mcp.json.example" "$PI_DEST/mcp.json"
fi

if [ -f "$PI_SRC/keybindings.json.example" ]; then
    copy_example_item "$PI_SRC/keybindings.json.example" "$PI_DEST/keybindings.json"
fi

log_success "$(i18n pi.done "$PI_DEST")"
