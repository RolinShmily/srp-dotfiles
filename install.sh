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
        nodejs python3 python3-pip python3-venv \
        git build-essential gcc unzip \
        fastfetch btop"

    sudo apt-get install -y $APT_PKGS
    
    if ! command -v npm >/dev/null 2>&1; then
        log_info "未检测到 npm，正在补充安装 npm 包..."
        sudo apt-get install -y npm || log_warn "npm 安装失败，请检查 Node.js 环境。"
    fi

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
