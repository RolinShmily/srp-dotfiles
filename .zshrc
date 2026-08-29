# ~/.zshrc - Dotfiles 模块化 Zsh 配置主入口

# ------------------------------------------------------------------
# 1. 解析 Dotfiles 所在物理目录
# ------------------------------------------------------------------
if [ -n "$ZSH_DOTFILES_DIR" ]; then
    DOTFILES_DIR="$ZSH_DOTFILES_DIR"
elif [ -L "$HOME/.zshrc" ]; then
    # 获取软链接指向的真实文件目录
    _target="$(readlink "$HOME/.zshrc")"
    if [[ "$_target" = /* ]]; then
        DOTFILES_DIR="$(dirname "$_target")"
    else
        DOTFILES_DIR="$(cd "$(dirname "$HOME/$_target")" && pwd)"
    fi
    unset _target
elif [ -d "$HOME/.dotfiles" ]; then
    DOTFILES_DIR="$HOME/.dotfiles"
elif [ -d "$HOME/Projects/srp-dotfiles" ]; then
    DOTFILES_DIR="$HOME/Projects/srp-dotfiles"
else
    DOTFILES_DIR="${${(%):-%N}:A:h}"
fi

export DOTFILES_DIR

# ------------------------------------------------------------------
# 2. 按顺序加载通用模块
# ------------------------------------------------------------------
_generic_modules=(
    env
    omz
    git
    aliases
    tools
)

for _mod in "${_generic_modules[@]}"; do
    if [ -f "$DOTFILES_DIR/zsh.d/${_mod}.zsh" ]; then
        source "$DOTFILES_DIR/zsh.d/${_mod}.zsh"
    fi
done
unset _mod _generic_modules

# ------------------------------------------------------------------
# 3. 动态识别操作系统并加载特供模块
# ------------------------------------------------------------------
_detect_os_module() {
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

_CURRENT_OS="$(_detect_os_module)"
if [ -f "$DOTFILES_DIR/zsh.d/os/${_CURRENT_OS}.zsh" ]; then
    source "$DOTFILES_DIR/zsh.d/os/${_CURRENT_OS}.zsh"
fi
unset _CURRENT_OS _detect_os_module

# ------------------------------------------------------------------
# 4. 加载单机专属私有配置（不入 Git 仓库，可存放私有 Token/密钥）
# ------------------------------------------------------------------
if [ -f "$HOME/.zshrc.local" ]; then
    source "$HOME/.zshrc.local"
fi
