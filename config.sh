#!/usr/bin/env bash

# config.sh - Dotfiles 软链接配置部署脚本

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"
FORCE=0

while [ $# -gt 0 ]; do
    case "$1" in
        -f|--force)
            FORCE=1
            shift
            ;;
        *)
            echo "未知选项: $1"
            echo "用法: $0 [-f|--force]"
            exit 1
            ;;
    esac
done

GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
RESET="\033[0m"

log_info() { printf "${BLUE}[INFO]${RESET} %s\n" "$1"; }
log_success() { printf "${GREEN}[OK]${RESET} %s\n" "$1"; }
log_warn() { printf "${YELLOW}[WARN]${RESET} %s\n" "$1"; }

link_file() {
    local src="$1"
    local dest="$2"

    if [ ! -e "$src" ]; then
        log_warn "源文件不存在，跳过: $src"
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

setup_omz_plugins() {
    if [ -d "$HOME/.oh-my-zsh" ]; then
        local custom_dir="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
        mkdir -p "$custom_dir/plugins" "$custom_dir/themes"

        if [ ! -d "$custom_dir/plugins/zsh-autosuggestions" ]; then
            log_info "下载 Oh My Zsh 插件: zsh-autosuggestions..."
            git clone https://github.com/zsh-users/zsh-autosuggestions "$custom_dir/plugins/zsh-autosuggestions"
        fi

        if [ ! -d "$custom_dir/plugins/zsh-syntax-highlighting" ]; then
            log_info "下载 Oh My Zsh 插件: zsh-syntax-highlighting..."
            git clone https://github.com/zsh-users/zsh-syntax-highlighting "$custom_dir/plugins/zsh-syntax-highlighting"
        fi

        if [ ! -d "$custom_dir/themes/spaceship-prompt" ]; then
            log_info "下载 Spaceship Prompt 主题..."
            git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$custom_dir/themes/spaceship-prompt" --depth=1
            ln -sf "$custom_dir/themes/spaceship-prompt/spaceship.zsh-theme" "$custom_dir/themes/spaceship.zsh-theme"
        fi
    fi
}

log_info "开始部署 Dotfiles 配置文件..."
[ "$FORCE" -eq 1 ] && log_info "已开启强制覆盖模式 (-f / --force)。"

# 检查并自动获取 Oh My Zsh 自定义插件与主题
setup_omz_plugins

# 部署主目录配置文件
log_info "部署 ~/. 配置文件..."
link_file "$DOTFILES_DIR/home/.zshrc" "$HOME/.zshrc"
link_file "$DOTFILES_DIR/home/.hushlogin" "$HOME/.hushlogin"

# 部署 ~/.config/ 配置目录
log_info "部署 ~/.config/ 软件配置目录..."
CONFIG_APPS="fastfetch nvim yazi zellij"
for app in $CONFIG_APPS; do
    link_file "$DOTFILES_DIR/config/$app" "$HOME/.config/$app"
done


log_success "Dotfiles 配置部署完成。请在终端执行: source ~/.zshrc (或重新打开终端) 以使配置立即生效。"

if [ -d "$BACKUP_DIR" ]; then
    log_info "已有文件已自动备份至: $BACKUP_DIR"
fi
