# zsh.d/aliases.zsh - 通用别名、现代 CLI 增强与目录导航函数

# -------------------------------- #
# 基础终端别名
# -------------------------------- #
alias cl='clear'
alias e='exit'
alias ff='fastfetch'

# -------------------------------- #
# 现代 CLI 工具替代
# -------------------------------- #
if command -v bat &>/dev/null; then
    alias cat='bat --style=header,grid,numbers --paging=never'
elif command -v batcat &>/dev/null; then
    alias cat='batcat --style=header,grid,numbers --paging=never'
fi

if command -v fd &>/dev/null; then
    alias find='fd'
elif command -v fdfind &>/dev/null; then
    alias find='fdfind'
    alias fd='fdfind'
fi

if command -v tldr &>/dev/null; then
    alias help='tldr'
elif command -v tealdeer &>/dev/null; then
    alias help='tealdeer'
fi

# eza 目录列表增强
if command -v eza &>/dev/null; then
    alias ls='eza --icons --group-directories-first'
    alias l='eza -1 --icons --group-directories-first'
    alias ll='eza -lh --icons --git --group-directories-first'
    alias la='eza -lah --icons --git --group-directories-first'
    alias lt='eza --tree --level=2 --icons --group-directories-first'
    alias lm='eza -lah --icons --git --sort=modified'
    alias lmd='eza -lah --icons --git --sort=modified --reverse'
fi

# -------------------------------- #
# 目录导航与快捷命令
# -------------------------------- #

# 跳转到 Projects 目录 (~/Projects)
function proj() {
    local target="${1:-}"
    local base="${PROJECTS_DIR:-$HOME/Projects}"
    if [[ -n "$target" ]]; then
        cd -- "$base/$target"
    else
        cd -- "$base"
    fi
}

# 创建目录并进入
function dir() {
    mkdir -p -- "$1" && cd -- "$1"
}

# 克隆仓库并进入
function clone() {
    if [[ -z $2 ]]; then
        git clone "$@" && cd "$(basename "$1" .git)"
    else
        git clone "$@" && cd "$2"
    fi
}

# 在 Projects 下克隆并用 VS Code 打开
function clonep() {
    proj && clone "$@" && code . && cd -
}

# 在 Projects 下直接用 VS Code 打开指定项目
function codep() {
    proj && code "$@" && cd -
}

# 本地快速静态服务器
function serve() {
    if [[ -z $1 ]]; then
        live-server dist
    else
        live-server "$1"
    fi
}
