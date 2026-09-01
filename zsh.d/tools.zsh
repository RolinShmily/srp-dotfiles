# zsh.d/tools.zsh - 终端工具（Zellij, Yazi, Zoxide, FZF）集成

# -------------------------------- #
# Zellij (终端复用器)
# -------------------------------- #
if command -v zellij &>/dev/null; then
    alias ze='zellij'
fi

# -------------------------------- #
# Yazi (终端文件管理器 & cwd 同步函数)
# -------------------------------- #
if command -v yazi &>/dev/null; then
    function yz() {
        local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
        yazi "$@" --cwd-file="$tmp"
        if cwd="$(command cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
            builtin cd -- "$cwd"
        fi
        rm -f -- "$tmp"
    }
fi

# -------------------------------- #
# Zoxide (智能目录跳转)
# -------------------------------- #
if command -v zoxide &>/dev/null; then
    eval "$(zoxide init zsh)"
fi

# -------------------------------- #
# FZF (模糊搜索与色彩主题)
# -------------------------------- #
if command -v fzf &>/dev/null; then
    if command -v fd &>/dev/null; then
        export FZF_DEFAULT_COMMAND='fd --type f --hidden --exclude .git'
        export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    elif command -v fdfind &>/dev/null; then
        export FZF_DEFAULT_COMMAND='fdfind --type f --hidden --exclude .git'
        export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    fi

    export FZF_DEFAULT_OPTS="$FZF_DEFAULT_OPTS \
      --highlight-line \
      --info=inline-right \
      --ansi \
      --layout=reverse \
      --border=none \
      --color=bg+:#2d3f76 \
      --color=bg:#1e2030 \
      --color=border:#589ed7 \
      --color=fg:#c8d3f5 \
      --color=gutter:#1e2030 \
      --color=header:#ff966c \
      --color=hl+:#65bcff \
      --color=hl:#65bcff \
      --color=info:#545c7e \
      --color=marker:#ff007c \
      --color=pointer:#ff007c \
      --color=prompt:#65bcff \
      --color=query:#c8d3f5:regular \
      --color=scrollbar:#589ed7 \
      --color=separator:#ff966c \
      --color=spinner:#ff007c \
    "
fi
