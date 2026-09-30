#!/usr/bin/env bash
# scripts/configs/pi.sh — Pi Coding Agent 配置部署（Unix）。
#
# 部署策略: 全部 copy 覆盖，不做备份、不做比对。
#   pi/ 目录扇出到 ~/.pi/agent/ 下的四个位置，
#   pi/extensions 按 manifest 的 piExtensions 白名单过滤，
#   pi/settings.json.example 复制后再把 manifest 的 piPackages 注入 packages 字段。
#
# 注意: pi/packages/ 下的本地包**不部署**。manifest 的 piPackages 里写
#   @repo/pi/packages/<name>，由 pi-inject-packages.js 展开成仓库绝对路径，Pi 直接从仓库加载。
#
# 可独立运行: bash scripts/configs/pi.sh
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
MANIFEST_JS="$DOTFILES_DIR/scripts/lib/manifest.js"
INJECT_JS="$DOTFILES_DIR/scripts/lib/pi-inject-packages.js"

if [ ! -d "$PI_SRC" ]; then
    log_warn "仓库中不存在 pi 目录: $PI_SRC"
    exit 1
fi

mkdir -p "$PI_DEST"

# 目标目录里有、仓库里没有的项：只提示不删除（副本无法判断归属）
report_orphans() {
    local sub="$1"
    local src_dir="$PI_SRC/$sub" dest_dir="$PI_DEST/$sub"
    [ -d "$dest_dir" ] || return 0

    local orphans=() item bn
    for item in "$dest_dir"/*; do
        [ -e "$item" ] || continue
        bn="${item##*/}"
        [ -e "$src_dir/$bn" ] || orphans+=("$bn")
    done

    if [ ${#orphans[@]} -gt 0 ]; then
        log_warn "[$sub] 目标里存在仓库中已不存在的项（不会自动删除）: ${orphans[*]}"
    fi
}

# 把 $PI_SRC/<子目录> 的每个子项覆盖复制到 $PI_DEST/<子目录>/
# 参数: <子目录名> [白名单|...]
copy_each_into() {
    local sub="$1" allowed="${2:-}"
    local src_dir="$PI_SRC/$sub"
    local dest_dir="$PI_DEST/$sub"

    [ -d "$src_dir" ] || return 0

    mkdir -p "$dest_dir"

    local item name
    for item in "$src_dir"/*; do
        [ -e "$item" ] || continue
        name="${item##*/}"
        if [ -n "$allowed" ]; then
            case "|$allowed|" in
                *"|$name|"*) ;;
                *) continue ;;
            esac
        fi
        copy_item "$item" "$dest_dir/$name"
    done
}

# 白名单语义: extensions 目录里不在白名单的项一律清理。
# skills / prompts / agents 无白名单，所以只警告孤儿，不删。
prune_extensions() {
    local allowed="$1"
    local dest_dir="$PI_DEST/extensions"

    [ -d "$dest_dir" ] || return 0
    [ -n "$allowed" ] || return 0

    local item name
    for item in "$dest_dir"/*; do
        [ -e "$item" ] || continue
        name="${item##*/}"
        case "|$allowed|" in
            *"|$name|"*) ;;
            *)
                log_warn "[extensions] 不在白名单，已清理: $name"
                rm -rf "$item"
                ;;
        esac
    done
}

# ---------- 1. 全局规范 ----------
[ -f "$PI_SRC/AGENTS.md" ] && copy_item "$PI_SRC/AGENTS.md" "$PI_DEST/AGENTS.md"

# ---------- 2. settings.json: 直复制覆盖，再注入 manifest 的 packages ----------
if [ -f "$PI_SRC/settings.json.example" ]; then
    copy_item "$PI_SRC/settings.json.example" "$PI_DEST/settings.json"

    if command -v node >/dev/null 2>&1 && [ -f "$MANIFEST_JS" ] && [ -f "$INJECT_JS" ]; then
        pkgs=()
        while IFS= read -r line; do
            [ -n "$line" ] && pkgs+=("$line")
        done < <(node "$MANIFEST_JS" get "$PI_MANIFEST_OS" piPackages 2>/dev/null || true)

        if [ ${#pkgs[@]} -gt 0 ]; then
            node "$INJECT_JS" "$PI_DEST/settings.json" "${pkgs[@]}"
        else
            log_info "manifest 的 piPackages 为空，settings.json 的 packages 保持模板值"
        fi
    else
        log_warn "缺少 node 或脚本，跳过 packages 注入"
    fi
fi

# ---------- 2b. mcp.json: 直复制覆盖（pi 内置 MCP 读取本路径）----------
# 注: ~/.pi/agent/mcp.json 也是 pi 自己会写的文件（/mcp 界面、pi mcp add/remove），
#     部署会覆盖那些改动；想保留就把改动搬回 pi/mcp.json.example。
if [ -f "$PI_SRC/mcp.json.example" ]; then
    copy_item "$PI_SRC/mcp.json.example" "$PI_DEST/mcp.json"
fi

# ---------- 3. extensions（按 manifest 白名单过滤） ----------
allowed_ext=""
if command -v node >/dev/null 2>&1 && [ -f "$MANIFEST_JS" ]; then
    allowed_ext="$(node "$MANIFEST_JS" get "$PI_MANIFEST_OS" piExtensions 2>/dev/null | paste -sd'|' - || true)"
fi
copy_each_into "extensions" "$allowed_ext"
prune_extensions "$allowed_ext"

# ---------- 4. skills / prompts / agents ----------
# agents 不检查孤儿: pi-learn 包会在每次会话通过 syncAgents() 往目标目录写入
# mermaid-maker.md / svg-maker.md，那些不是遗留副本，所以不提醒。
copy_each_into "skills";  report_orphans "skills"
copy_each_into "prompts"; report_orphans "prompts"
copy_each_into "agents"

# ---------- 5. packages ----------
# 本地 Pi 包**不做复制**。manifest 的 piPackages 里写 @repo/pi/packages/<name>，
# 部署时由 pi-inject-packages.js 展开成仓库绝对路径，Pi 直接从仓库加载（local 源不复制）。
# ~/.pi/agent/packages/ 是历史自造约定，已废弃 —— 若存在旧副本请手动删除。

log_success "Pi 配置部署完成 (copy 覆盖): $PI_DEST"
