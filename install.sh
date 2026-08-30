#!/usr/bin/env bash

# install.sh - SrP-Dotfiles 统一跨平台依赖包安装引擎 (基于 manifest.toml)

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_FILE="$DOTFILES_DIR/manifest.toml"

GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${RESET} $1"; }
log_error() { echo -e "${RED}[ERROR]${RESET} $1"; }

# ------------------------------------------------------------------
# 1. 零依赖 TOML 解析器 (基于 Awk)
# ------------------------------------------------------------------
parse_toml_val() {
    local section="$1"
    local key="$2"
    local file="$3"
    awk -v target_sec="[$section]" -v target_key="$key" '
        /^[ \t]*#/ { next }
        $0 ~ "^[ \t]*\\[" {
            clean = $0
            gsub(/[ \t]/, "", clean)
            in_sec = (clean == target_sec)
        }
        in_sec && $0 ~ "^[ \t]*" target_key "[ \t]*=" {
            idx = index($0, "=")
            val = substr($0, idx + 1)
            sub(/^[ \t]*/, "", val)
            sub(/[ \t\r\n]*$/, "", val)
            gsub(/(^"|"$)/, "", val)
            print val
            exit
        }
    ' "$file"
}

parse_toml_array() {
    local section="$1"
    local key="$2"
    local file="$3"
    awk -v target_sec="[$section]" -v target_key="$key" '
        /^[ \t]*#/ { next }
        $0 ~ "^[ \t]*\\[" {
            clean = $0
            gsub(/[ \t]/, "", clean)
            in_sec = (clean == target_sec)
        }
        in_sec && $0 ~ "^[ \t]*" target_key "[ \t]*=" {
            in_arr = 1
            idx = index($0, "=")
            line = substr($0, idx + 1)
        }
        in_arr {
            if (line == "") line = $0
            while (match(line, /"[^"]*"/)) {
                item = substr(line, RSTART + 1, RLENGTH - 2)
                if (item != "") print item
                line = substr(line, RSTART + RLENGTH)
            }
            if ($0 ~ /\]/) {
                in_arr = 0
                exit
            }
            line = ""
        }
    ' "$file"
}

# ------------------------------------------------------------------
# 2. 操作系统探测与参数解析
# ------------------------------------------------------------------
detect_os() {
    if [ -d "/data/data/com.termux" ]; then
        echo "termux"
    elif [ -f /etc/os-release ]; then
        if grep -qi "arch" /etc/os-release; then
            echo "arch"
        elif grep -qiE "debian|ubuntu" /etc/os-release; then
            echo "debian"
        else
            echo "arch"
        fi
    elif [ -f /etc/arch-release ]; then
        echo "arch"
    elif [ -f /etc/debian_version ]; then
        echo "debian"
    else
        echo "arch"
    fi
}

TARGET_OS=""

while [ $# -gt 0 ]; do
    case "$1" in
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        arch|debian|termux)
            TARGET_OS="$1"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$TARGET_OS" ]; then
    TARGET_OS="$(detect_os)"
fi

log_info "目标操作系统识别为: ${GREEN}${TARGET_OS}${RESET}"

if [ ! -f "$MANIFEST_FILE" ]; then
    log_error "未找到清单文件: $MANIFEST_FILE"
    exit 1
fi

# ------------------------------------------------------------------
# 3. 从 manifest.toml 读取配置
# ------------------------------------------------------------------
PACKAGE_MANAGER="$(parse_toml_val "$TARGET_OS" "package_manager" "$MANIFEST_FILE")"
readarray -t PKGS < <(parse_toml_array "$TARGET_OS" "packages" "$MANIFEST_FILE")
readarray -t NPM_GLOBALS < <(parse_toml_array "$TARGET_OS" "npm_globals" "$MANIFEST_FILE")
readarray -t SKILLS_ADD < <(parse_toml_array "$TARGET_OS" "skills_add" "$MANIFEST_FILE")

if [ ${#PKGS[@]} -eq 0 ]; then
    log_error "未能从 manifest.toml 读取到 [$TARGET_OS] 的依赖包列表"
    exit 1
fi

# ------------------------------------------------------------------
# 4. 执行包管理器安装
# ------------------------------------------------------------------
log_info "正在使用 ${PACKAGE_MANAGER} 安装系统依赖包 (${#PKGS[@]} 个)..."

case "$TARGET_OS" in
    arch)
        # 注意: Arch Linux 滚动更新机制禁止部分升级 (-Sy pkg)，必须同步完整系统更新 (-Syu)
        sudo pacman -Syu --needed --noconfirm "${PKGS[@]}"
        log_success "Arch Linux (pacman) 系统依赖安装完成。"
        ;;
    debian)
        sudo apt-get update -y
        sudo apt-get install -y "${PKGS[@]}"
        log_success "Debian/Ubuntu (apt) 系统依赖安装完成。"
        ;;
    termux)
        pkg update -y
        pkg install -y "${PKGS[@]}"
        log_success "Termux (pkg) 系统依赖安装完成。"
        ;;
    *)
        log_warn "未知的操作系统类型: $TARGET_OS，跳过系统包管理器安装。"
        ;;
esac

# ------------------------------------------------------------------
# 5. 设置默认 Shell 为 zsh
# ------------------------------------------------------------------
set_default_shell() {
    if command -v zsh &>/dev/null; then
        local zsh_path
        zsh_path="$(which zsh)"

        if [ "$TARGET_OS" != "termux" ]; then
            if ! grep -q "^${zsh_path}$" /etc/shells 2>/dev/null; then
                echo "$zsh_path" | sudo tee -a /etc/shells >/dev/null 2>&1 || true
            fi
            local current_user="${USER:-$(whoami)}"
            if [ "$SHELL" != "$zsh_path" ]; then
                log_info "设置当前用户 ($current_user) 默认 Shell 为 $zsh_path..."
                sudo chsh -s "$zsh_path" "$current_user" 2>/dev/null || chsh -s "$zsh_path" 2>/dev/null || true
                log_success "默认 Shell 已修改为 $zsh_path。"
            fi
        else
            if [ "$SHELL" != "$zsh_path" ]; then
                log_info "设置 Termux 默认 Shell 为 $zsh_path..."
                chsh -s "$zsh_path" 2>/dev/null || true
                log_success "默认 Shell 已修改为 $zsh_path。"
            fi
        fi
    fi
}

set_default_shell

# ------------------------------------------------------------------
# 6. 安装 Oh My Zsh
# ------------------------------------------------------------------
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    log_info "Oh My Zsh 未安装，开始自动获取..."
    env RUNZSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || true
    log_success "Oh My Zsh 安装完成。"
fi

# ------------------------------------------------------------------
# 7. 全局 npm 包安装
# ------------------------------------------------------------------
if [ ${#NPM_GLOBALS[@]} -gt 0 ]; then
    log_info "正在使用 npm 安装全局依赖 (启用 --ignore-scripts 安全模式): ${NPM_GLOBALS[*]}"
    if command -v npm &>/dev/null; then
        if [ "$TARGET_OS" = "termux" ]; then
            npm install -g --ignore-scripts "${NPM_GLOBALS[@]}" || true
        else
            sudo npm install -g --ignore-scripts "${NPM_GLOBALS[@]}" 2>/dev/null || npm install -g --ignore-scripts "${NPM_GLOBALS[@]}" || true
        fi
        log_success "全局 npm 依赖包安装完成。"
    else
        log_warn "未检测到 npm 命令，跳过全局 npm 包安装。"
    fi
fi

# ------------------------------------------------------------------
# 8. 安装第三方 Agent Skills (基于 skills_add)
# ------------------------------------------------------------------
if [ ${#SKILLS_ADD[@]} -gt 0 ]; then
    log_info "正在安装第三方 Agent Skills (${#SKILLS_ADD[@]} 个)..."
    for skill_item in "${SKILLS_ADD[@]}"; do
        skill_item="$(echo "$skill_item" | xargs)"
        [ -z "$skill_item" ] && continue

        # 若未显式包含 -a 或 --agent 参数，默认指定 -a pi 避免因不支持全局的 agent 导致报错
        local agent_param=""
        if [[ ! "$skill_item" =~ (-a|--agent) ]]; then
            agent_param="-a pi"
        fi

        log_info "正在拉取技能: $skill_item ..."
        if command -v skills &>/dev/null; then
            skills add $skill_item $agent_param -g -y || log_warn "技能拉取失败: $skill_item (已跳过)"
        elif command -v npx &>/dev/null; then
            npx --yes skills add $skill_item $agent_param -g -y || log_warn "技能拉取失败: $skill_item (已跳过)"
        else
            log_warn "未检测到 skills 或 npx 命令，跳过技能安装: $skill_item"
        fi
    done
    log_success "第三方 Agent Skills 安装处理完成。"
fi

log_success "所有系统依赖安装完成！接下来请运行 ./config.sh 部署配置文件。"
