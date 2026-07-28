#!/bin/sh

# install.sh - Debian 13 环境依赖安装脚本

set -e

GREEN="\033[0;32m"
BLUE="\033[0;34m"
RESET="\033[0m"

log_info() { printf "${BLUE}[INFO]${RESET} %s\n" "$1"; }
log_success() { printf "${GREEN}[OK]${RESET} %s\n" "$1"; }

log_info "开始安装 Debian 13 系统依赖包..."

if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y

    APT_PKGS="zsh zsh-autosuggestions zsh-syntax-highlighting \
        eza zoxide fzf bat fd-find ripgrep gh lazygit jq tealdeer \
        nodejs npm python3 python3-pip python3-venv \
        neovim git build-essential gcc unzip \
        kitty fastfetch btop"

    sudo apt-get install -y $APT_PKGS
    log_success "Debian 系统软件包 (apt) 安装完成。"
fi

# 设置当前用户默认 Shell 为 zsh
set_default_shell() {
    if command -v zsh >/dev/null 2>&1; then
        local zsh_path
        if grep -q "^/usr/bin/zsh$" /etc/shells; then
            zsh_path="/usr/bin/zsh"
        elif grep -q "^/bin/zsh$" /etc/shells; then
            zsh_path="/bin/zsh"
        else
            zsh_path="$(which zsh)"
            echo "$zsh_path" | sudo tee -a /etc/shells >/dev/null
        fi

        local current_user="${USER:-$(whoami)}"
        if [ "$SHELL" != "$zsh_path" ]; then
            log_info "设置当前用户 ($current_user) 默认 Shell 为 $zsh_path..."
            sudo chsh -s "$zsh_path" "$current_user" || chsh -s "$zsh_path"
            log_success "默认 Shell 已修改为 $zsh_path。"
        fi
    fi
}

set_default_shell

# 安装 Oh My Zsh
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    log_info "Oh My Zsh 未安装，开始自动安装..."
    env RUNZSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || true
    log_success "Oh My Zsh 安装完成。"
fi

log_info "检查 Node.js / Bun 全局工具包依赖..."

NPM_GLOBAL_PKGS="@antfu/ni live-server"

if command -v bun >/dev/null 2>&1; then
    log_info "使用 bun 安装全局依赖: $NPM_GLOBAL_PKGS"
    bun add -g $NPM_GLOBAL_PKGS
    log_success "全局 npm 包 (bun) 安装完成。"
elif command -v npm >/dev/null 2>&1; then
    log_info "使用 npm 安装全局依赖: $NPM_GLOBAL_PKGS"
    sudo npm install -g $NPM_GLOBAL_PKGS || npm install -g $NPM_GLOBAL_PKGS
    log_success "全局 npm 包 (npm) 安装完成。"
fi

log_success "所有依赖安装完成。请运行 ./config.sh 部署配置文件。"
