#!/usr/bin/env bash

# install.sh - Termux 环境依赖安装脚本

set -e

GREEN="\033[0;32m"
BLUE="\033[0;34m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }

log_info "开始安装 Termux 系统依赖包..."

# 更新包列表
pkg update -y

TERMUX_PKGS="zsh eza zoxide fzf bat fd ripgrep diff-so-fancy gh lazygit jq tealdeer nodejs python uv yazi file chafa imagemagick poppler ffmpeg p7zip unar exiftool mediainfo miller git clang make unzip tree-sitter zellij fastfetch htop termux-api"

pkg install -y $TERMUX_PKGS
log_success "Termux 系统软件包安装完成。"

# 设置当前用户默认 Shell 为 zsh
set_default_shell() {
    if command -v zsh &>/dev/null; then
        local zsh_path
        zsh_path="$(which zsh)"
        if [ "$SHELL" != "$zsh_path" ]; then
            log_info "设置默认 Shell 为 $zsh_path..."
            chsh -s "$zsh_path"
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

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"

log_info "安装 Zsh 插件与主题..."
if [ ! -d "$ZSH_CUSTOM/themes/spaceship-prompt" ]; then
    git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
    ln -sf "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"
fi
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
fi
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
fi
log_success "Zsh 插件与主题安装完成。"

log_info "检查 Node.js 全局工具包依赖..."

NPM_GLOBAL_PKGS="@antfu/ni live-server"

if command -v npm &>/dev/null; then
    log_info "使用 npm 安装全局依赖: $NPM_GLOBAL_PKGS"
    npm install -g $NPM_GLOBAL_PKGS
    log_success "全局 npm 包安装完成。"
fi

log_success "所有依赖安装完成。请运行 ./config.sh 部署配置文件。"

# 安装定制版 Neovim v0.11.7 (二进制)
log_info "从 Github 下载并安装 Neovim v0.11.7 二进制版本..."
NVIM_VERSION="v0.11.7"
NVIM_URL="https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux-x86_64.tar.gz"
NVIM_DIR="$HOME/.local/nvim-linux-x86_64"

mkdir -p "$HOME/.local/bin"
cd /tmp
curl -L -O "$NVIM_URL"
tar xzf nvim-linux-x86_64.tar.gz
rm -rf "$NVIM_DIR"
mv nvim-linux-x86_64 "$HOME/.local/"
ln -sf "$NVIM_DIR/bin/nvim" "$HOME/.local/bin/nvim"
rm -f /tmp/nvim-linux-x86_64.tar.gz
log_success "Neovim v0.11.7 安装完成。请确保 ~/.local/bin 在 PATH 中。"
