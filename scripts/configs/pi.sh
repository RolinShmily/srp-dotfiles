#!/usr/bin/env bash
# scripts/configs/pi.sh — Pi Coding Agent 配置部署（Unix）。
#
# 部署策略: 全部 copy 覆盖，不做备份、不做比对。
#   pi/ 目录扇出到 ~/.pi/agent/ 下的四个位置，
#   pi/extensions 按 manifest 的 piExtensions 白名单过滤，
#   .example 配置先检查正式目标：不存在时生成 JSON，存在时保留并旁存 .json.example；
#   仅新生成的 settings.json 会注入 manifest 的 piPackages。
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

# ---------- 2. settings.json: 目标不存在时生成；已存在时保留并部署 example ----------
if [ -f "$PI_SRC/settings.json.example" ]; then
    settings_target="$PI_DEST/settings.json"
    settings_deploy_target="$(example_target_path "$settings_target")"
    if [ "$settings_deploy_target" = "$settings_target" ]; then
        log_info "settings.json 不存在，使用模板创建"
    else
        log_info "检测到已有 settings.json，保留原文件；模板将保存为 settings.json.example"
    fi
    copy_item "$PI_SRC/settings.json.example" "$settings_deploy_target"

    if [ "$settings_deploy_target" = "$settings_target" ]; then
        if command -v node >/dev/null 2>&1 && [ -f "$MANIFEST_JS" ] && [ -f "$INJECT_JS" ]; then
            pkgs=()
            while IFS= read -r line; do
                [ -n "$line" ] && pkgs+=("$line")
            done < <(node "$MANIFEST_JS" get "$PI_MANIFEST_OS" piPackages 2>/dev/null || true)

            if [ ${#pkgs[@]} -gt 0 ]; then
                node "$INJECT_JS" "$settings_target" "${pkgs[@]}"
            else
                log_info "manifest 的 piPackages 为空，settings.json 的 packages 保持模板值"
            fi
        else
            log_warn "缺少 node 或脚本，跳过 packages 注入"
        fi
    else
        log_info "已有 settings.json 保持不动，跳过 packages 注入"
    fi
fi

# ---------- 2b. mcp.json: 目标不存在时生成；已存在时部署 example ----------
# pi 也会写入 mcp.json（/mcp 界面、pi mcp add/remove）；已有配置会保留，模板另存为 example。
if [ -f "$PI_SRC/mcp.json.example" ]; then
    copy_example_item "$PI_SRC/mcp.json.example" "$PI_DEST/mcp.json"
fi

# ---------- 2c. keybindings.json: 目标不存在时生成；已存在时部署 example ----------
if [ -f "$PI_SRC/keybindings.json.example" ]; then
    copy_example_item "$PI_SRC/keybindings.json.example" "$PI_DEST/keybindings.json"
fi

# ---------- 3. extensions（按 manifest 白名单过滤） ----------
allowed_ext=""
if command -v node >/dev/null 2>&1 && [ -f "$MANIFEST_JS" ]; then
    allowed_ext="$(node "$MANIFEST_JS" get "$PI_MANIFEST_OS" piExtensions 2>/dev/null | paste -sd'|' - || true)"
fi
copy_each_into "extensions" "$allowed_ext"
prune_extensions "$allowed_ext"

# ---------- 4. skills / prompts ----------
# agents 由 pi-learn 包自带并在每次会话通过 syncAgents() 自动同步到目标目录
copy_each_into "skills";  report_orphans "skills"
copy_each_into "prompts"; report_orphans "prompts"

# ---------- 5. packages ----------
# 本地 Pi 包**不做复制**。manifest 的 piPackages 里写 @repo/pi/packages/<name>，
# 部署时由 pi-inject-packages.js 展开成仓库绝对路径，Pi 直接从仓库加载（local 源不复制）。
# ~/.pi/agent/packages/ 是历史自造约定，已废弃 —— 若存在旧副本请手动删除。

# ---------- 6. CLI 命令软链接（manifest 的 piCliLinks: <name>=<仓库相对路径>） ----------
# 有些扩展同时提供一个 CLI（如 subagent 的 spawn/status/send/wait/stop），
# 由扩展捆绑的 skill 通过 bash 调用，所以需要在 PATH 上放个入口。
# pi 自己会把 ~/.pi/agent/bin 加进 bash 工具的 PATH，这里只负责建链接。
# 链接指向**已部署的那份副本**（而非仓库源），否则 CLI 与实际加载的扩展可能不同版本，
# 两边对 metadata.json 的字段认知会不一致。
while IFS= read -r cli_link; do
    [ -n "$cli_link" ] || continue
    cli_name="${cli_link%%=*}"
    cli_rel="${cli_link#*=}"
    link_item "$PI_DEST/$cli_rel" "$PI_DEST/bin/$cli_name" || true
done < <(node "$MANIFEST_JS" get "$PI_MANIFEST_OS" piCliLinks 2>/dev/null || true)

log_success "Pi 配置部署完成 (copy 覆盖): $PI_DEST"
