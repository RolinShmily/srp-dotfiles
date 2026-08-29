#!/usr/bin/env bash

# config.sh - SrP-Dotfiles 统一跨平台软链接配置部署引擎 (基于 manifest.toml)

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_FILE="$DOTFILES_DIR/manifest.toml"
BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"
FORCE=0
TARGET_OS=""

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
    elif [ "$(uname -s)" = "Darwin" ]; then
        echo "mac"
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

while [ $# -gt 0 ]; do
    case "$1" in
        -f|--force)
            FORCE=1
            shift
            ;;
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        arch|debian|mac|termux)
            TARGET_OS="$1"
            shift
            ;;
        *)
            log_warn "未知参数: $1"
            shift
            ;;
    esac
done

if [ -z "$TARGET_OS" ]; then
    TARGET_OS="$(detect_os)"
fi

log_info "目标配置环境识别为: ${GREEN}${TARGET_OS}${RESET}"
[ "$FORCE" -eq 1 ] && log_info "已开启强制覆盖模式 (-f / --force)。"

# ------------------------------------------------------------------
# 3. 核心软链接函数
# ------------------------------------------------------------------
link_file() {
    local src="$1"
    local dest="$2"

    if [ ! -e "$src" ]; then
        log_warn "源文件/目录不存在，跳过: $src"
        return
    fi

    mkdir -p "$(dirname "$dest")"

    if [ -L "$dest" ]; then
        local current_target
        current_target="$(readlink "$dest")"
        if [ "$current_target" = "$src" ]; then
            log_info "软链接已正确指向: $dest"
            return
        else
            log_warn "更新现有的软链接: $dest"
            rm "$dest"
        fi
    elif [ -e "$dest" ]; then
        if [ "$FORCE" -eq 1 ]; then
            log_warn "[强制模式] 删除现有非链接文件/目录: $dest"
            rm -rf "$dest"
        else
            mkdir -p "$BACKUP_DIR/$(dirname "${dest#$HOME/}")"
            log_warn "备份现有非链接文件: $dest -> $BACKUP_DIR/${dest#$HOME/}"
            mv "$dest" "$BACKUP_DIR/${dest#$HOME/}"
        fi
    fi

    ln -s "$src" "$dest"
    log_success "已创建软链接: $dest -> $src"
}

# ------------------------------------------------------------------
# 4. Oh My Zsh 插件与主题克隆
# ------------------------------------------------------------------
setup_omz_plugins() {
    if [ -d "$HOME/.oh-my-zsh" ]; then
        local custom_dir="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
        mkdir -p "$custom_dir/plugins" "$custom_dir/themes"

        if [ ! -d "$custom_dir/plugins/zsh-autosuggestions" ]; then
            log_info "下载 Oh My Zsh 插件: zsh-autosuggestions..."
            git clone https://github.com/zsh-users/zsh-autosuggestions "$custom_dir/plugins/zsh-autosuggestions" || true
        fi

        if [ ! -d "$custom_dir/plugins/zsh-syntax-highlighting" ]; then
            log_info "下载 Oh My Zsh 插件: zsh-syntax-highlighting..."
            git clone https://github.com/zsh-users/zsh-syntax-highlighting "$custom_dir/plugins/zsh-syntax-highlighting" || true
        fi

        if [ ! -d "$custom_dir/themes/spaceship-prompt" ]; then
            log_info "下载 Spaceship Prompt 主题..."
            git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$custom_dir/themes/spaceship-prompt" --depth=1 || true
            ln -sf "$custom_dir/themes/spaceship-prompt/spaceship.zsh-theme" "$custom_dir/themes/spaceship.zsh-theme" || true
        fi
    fi
}

log_info "开始部署 Dotfiles 配置文件..."
setup_omz_plugins

# ------------------------------------------------------------------
# 5. 部署主目录基础配置 (~/.zshrc, ~/.vimrc)
# ------------------------------------------------------------------
log_info "部署 ~/.zshrc 与 ~/.vimrc 基础配置..."
link_file "$DOTFILES_DIR/.zshrc" "$HOME/.zshrc"
[ -f "$DOTFILES_DIR/.vimrc" ] && link_file "$DOTFILES_DIR/.vimrc" "$HOME/.vimrc"

# ------------------------------------------------------------------
# 6. 从 manifest.toml 读取并部署各软件配置
# ------------------------------------------------------------------
readarray -t CONFIG_APPS < <(parse_toml_array "$TARGET_OS" "configs" "$MANIFEST_FILE")

log_info "为 [$TARGET_OS] 部署应用配置目录 (${#CONFIG_APPS[@]} 个)..."

for app in "${CONFIG_APPS[@]}"; do
    if [ "$app" = "pi" ]; then
        # 部署 Pi Coding Agent 配置
        log_info "部署 Pi Agent 配置..."
        PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
        mkdir -p "$PI_AGENT_DIR"

        [ -f "$DOTFILES_DIR/pi/settings.json" ] && link_file "$DOTFILES_DIR/pi/settings.json" "$PI_AGENT_DIR/settings.json"
        if [ -f "$DOTFILES_DIR/pi/AGENTS.md" ]; then
            link_file "$DOTFILES_DIR/pi/AGENTS.md" "$PI_AGENT_DIR/AGENTS.md"
        fi

        for res in extensions skills prompts themes agents; do
            if [ -d "$DOTFILES_DIR/pi/$res" ]; then
                link_file "$DOTFILES_DIR/pi/$res" "$PI_AGENT_DIR/$res"
            fi
        done
    else
        # 部署普通 ~/.config/<app>
        if [ -d "$DOTFILES_DIR/$app" ]; then
            link_file "$DOTFILES_DIR/$app" "$HOME/.config/$app"
        else
            log_warn "未找到配置目录: $DOTFILES_DIR/$app"
        fi
    fi
done

log_success "Dotfiles 配置部署完成！"
log_info "请在终端执行: source ~/.zshrc (或重启终端) 使配置立即生效。"

if [ -d "$BACKUP_DIR" ]; then
    log_info "已备份原有冲突文件至: $BACKUP_DIR"
fi
