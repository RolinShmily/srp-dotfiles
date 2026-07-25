#!/usr/bin/env bash

# install_debian.sh - Debian / Ubuntu 环境依赖安装脚本

set -e

GREEN="\033[0;32m"
BLUE="\033[0;34m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }

log_info "开始安装 Debian / Ubuntu 系统依赖包..."

if command -v apt-get &>/dev/null; then
    sudo apt-get update -y

    APT_PKGS=(
        # Shell 环境
        zsh zsh-autosuggestions zsh-syntax-highlighting
        # CLI 增强工具
        zoxide fzf bat fd-find ripgrep jq tldr diff-so-fancy
        # 语言与运行时
        nodejs npm python3 python3-pip
        # Yazi 预览与系统工具依赖
        file chafa imagemagick poppler-utils ffmpeg p7zip-full unar libimage-exiftool-perl mediainfo zathura miller xdg-utils xclip wl-clipboard
        # 编辑器与编译工具链
        neovim git build-essential gcc unzip curl
        # 系统监控
        btop
    )

    sudo apt-get install -y "${APT_PKGS[@]}" || true
    log_success "Debian / Ubuntu 系统软件包 (apt) 安装完成。"
fi

# 设置当前用户默认 Shell 为 zsh
set_default_shell() {
    if command -v zsh &>/dev/null; then
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

log_info "检查 Node.js / Bun 全局工具包依赖..."

NPM_GLOBAL_PKGS=(
    "@antfu/ni"
    "live-server"
)

if command -v bun &>/dev/null; then
    log_info "使用 bun 安装全局依赖: ${NPM_GLOBAL_PKGS[*]}"
    bun add -g "${NPM_GLOBAL_PKGS[@]}"
    log_success "全局 npm 包 (bun) 安装完成。"
elif command -v npm &>/dev/null; then
    log_info "使用 npm 安装全局依赖: ${NPM_GLOBAL_PKGS[*]}"
    sudo npm install -g "${NPM_GLOBAL_PKGS[@]}" || npm install -g "${NPM_GLOBAL_PKGS[@]}"
    log_success "全局 npm 包 (npm) 安装完成。"
fi

log_success "所有依赖安装完成。请运行 ./config.sh 部署配置文件。"
