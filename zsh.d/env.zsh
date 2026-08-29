# zsh.d/env.zsh - 基础环境变量、运行时环境与 PATH 配置

# -------------------------------- #
# Shell 补全
# -------------------------------- #
# OpenSpec shell completions configuration
if [ -d "$HOME/.oh-my-zsh/custom/completions" ]; then
    fpath=("$HOME/.oh-my-zsh/custom/completions" $fpath)
fi

# -------------------------------- #
# 语言与默认编辑器
# -------------------------------- #
export LANG=en_US.UTF-8
if command -v vim &>/dev/null; then
    export EDITOR="vim"
    export VISUAL="vim"
elif command -v vi &>/dev/null; then
    export EDITOR="vi"
    export VISUAL="vi"
fi

# -------------------------------- #
# Node.js (nvm)
# -------------------------------- #
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
elif [ -s "/usr/share/nvm/nvm.sh" ]; then
    . "/usr/share/nvm/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    . "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    . "/usr/local/opt/nvm/nvm.sh"
fi

if [ -f "$NVM_DIR/bash_completion" ]; then
    . "$NVM_DIR/bash_completion"
elif [ -f "/usr/share/nvm/bash_completion" ]; then
    . "/usr/share/nvm/bash_completion"
fi

# -------------------------------- #
# Bun
# -------------------------------- #
export BUN_INSTALL="$HOME/.bun"
if [ -d "$BUN_INSTALL/bin" ]; then
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# -------------------------------- #
# 本地二进制 PATH
# -------------------------------- #
[ -d "$HOME/.local/bin" ] && export PATH="$HOME/.local/bin:$PATH"
[ -d "$HOME/bin" ] && export PATH="$HOME/bin:$PATH"
