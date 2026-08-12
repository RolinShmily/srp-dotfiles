#!/usr/bin/env bash

# install.sh - macOS (Homebrew) 环境依赖安装脚本

set -e

GREEN="\033[0;32m"
BLUE="\033[0;34m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }

# 检查并安装 Homebrew
if ! command -v brew >/dev/null 2>&1; then
    log_info "未检测到 Homebrew，开始安装..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

log_info "开始安装 macOS 系统依赖包 (Homebrew)..."

BREW_PKGS=(
    # Shell 环境
    zsh zsh-autosuggestions zsh-syntax-highlighting
    # CLI 增强
    eza zoxide fzf bat fd ripgrep gh lazygit jq tealdeer
    # 语言与运行时
    node python
    # 编辑器 (Neovim)
    git unzip neovim
    # 终端
    kitty
    # 监控与系统 (Fastfetch / Btop)
    fastfetch btop
)

brew install "${BREW_PKGS[@]}"
log_success "macOS 系统软件包 (brew) 安装完成。"

# 设置当前用户默认 Shell 为 zsh
set_default_shell() {
    if command -v zsh >/dev/null 2>&1; then
        local zsh_path
        zsh_path="$(command -v zsh)"
        if ! grep -q "^${zsh_path}$" /etc/shells; then
            log_info "将 ${zsh_path} 添加到 /etc/shells..."
            echo "$zsh_path" | sudo tee -a /etc/shells >/dev/null
        fi

        local current_user="${USER:-$(whoami)}"
        if [ "$SHELL" != "$zsh_path" ]; then
            log_info "设置当前用户 ($current_user) 默认 Shell 为 $zsh_path..."
            chsh -s "$zsh_path" "$current_user" || sudo chsh -s "$zsh_path" "$current_user"
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

NPM_GLOBAL_PKGS=(
    "@antfu/ni"
    "live-server"
)

if command -v bun >/dev/null 2>&1; then
    log_info "使用 bun 安装全局依赖: ${NPM_GLOBAL_PKGS[*]}"
    bun add -g "${NPM_GLOBAL_PKGS[@]}"
    log_success "全局 npm 包 (bun) 安装完成。"
elif command -v npm >/dev/null 2>&1; then
    log_info "使用 npm 安装全局依赖: ${NPM_GLOBAL_PKGS[*]}"
    npm install -g "${NPM_GLOBAL_PKGS[@]}"
    log_success "全局 npm 包 (npm) 安装完成。"
fi

log_success "所有依赖安装完成。请运行 ./config.sh 部署配置文件。"
