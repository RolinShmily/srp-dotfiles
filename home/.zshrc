# OPENSPEC:START
# OpenSpec shell completions configuration
fpath=("$HOME/.oh-my-zsh/custom/completions" $fpath)
# OPENSPEC:END

export ZSH="$HOME/.oh-my-zsh"

# git clone https://github.com/denysdovhan/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
# ln -s "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"

# 禁用提示符的前置换行
SPACESHIP_PROMPT_ADD_NEWLINE=false

# 禁用提示符前后的换行
SPACESHIP_PROMPT_FIRST_PREFIX_SHOW=false
SPACESHIP_PROMPT_LAST_SUFFIX_SHOW=false

if [ "$TERM_PROGRAM" != "WarpTerminal" ]; then
  ZSH_THEME="spaceship"
fi

# git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
# git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
# git clone https://github.com/agkozak/zsh-z $ZSH_CUSTOM/plugins/zsh-z
plugins=(
  git
  zsh-autosuggestions
  zsh-syntax-highlighting
)

# https://ohmyz.sh/
source $ZSH/oh-my-zsh.sh

# -------------------------------- #
# Git
# -------------------------------- #


# Go to project root
alias grt='cd "$(git rev-parse --show-toplevel)"'

alias gs='git status'
alias gp='git push'
alias gpf='git push --force'
alias gpft='git push --follow-tags'
alias gpl='git pull --rebase'
alias gcl='git clone'
alias gst='git stash'
alias grm='git rm'
alias gmv='git mv'

alias main='git checkout main'

alias gco='git checkout'
alias gcob='git checkout -b'

alias gb='git branch'
alias gbd='git branch -d'

alias grb='git rebase'
alias grbc='git rebase --continue'

alias gl='git log'
alias glo='git log --oneline --graph'

alias grh='git reset HEAD'
alias grh1='git reset HEAD~1'

alias ga='git add'
alias gA='git add -A'

alias gc='git commit'
alias gcm='git commit -m'
alias gca='git commit -a'
alias gcam='git add -A && git commit -m'

alias gxn='git clean -dn'
alias gx='git clean -df'

function gsha() {
  local sha="$(git rev-parse HEAD)"
  if command -v clip.exe &>/dev/null; then
    echo -n "$sha" | clip.exe
  elif command -v wl-copy &>/dev/null; then
    echo -n "$sha" | wl-copy
  elif command -v xclip &>/dev/null; then
    echo -n "$sha" | xclip -selection clipboard
  else
    echo "$sha"
  fi
}

alias ghci='gh run list -L 1'

function glp() {
  git --no-pager log -"${1}"
}

function _git_origin_default_branch() {
  local origin_head

  origin_head="$(command git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)" || {
    if command git show-ref --verify --quiet refs/remotes/origin/main; then
      echo "origin/main"
      return 0
    elif command git show-ref --verify --quiet refs/remotes/origin/master; then
      echo "origin/master"
      return 0
    fi

    return 1
  }

  echo "$origin_head"
}

function grbom() {
  local base

  base="$(_git_origin_default_branch)" || return 1
  git rebase "$base"
}

function gfrb() {
  local base

  git fetch origin || return 1
  base="$(_git_origin_default_branch)" || return 1
  git rebase "$base"
}

function gd() {
  if [[ -z $1 ]] then
    git diff --color | diff-so-fancy
  else
    git diff --color "$1" | diff-so-fancy
  fi
}

function gdc() {
  if [[ -z $1 ]] then
    git diff --color --cached | diff-so-fancy
  else
    git diff --color --cached "$1" | diff-so-fancy
  fi
}

# -------------------------------- #
# Directories & Navigation
# -------------------------------- #

# Jump to projects directory (~/Projects by default)
function proj() {
  local target="${1:-}"
  local base="${PROJECTS_DIR:-$HOME/Projects}"
  if [[ -n "$target" ]]; then
    cd -- "$base/$target"
  else
    cd -- "$base"
  fi
}

function pr() {
  if [[ "$1" == "ls" ]]; then
    gh pr list
  else
    gh pr checkout "$1"
  fi
}

function dir() {
  mkdir -p -- "$1" && cd -- "$1"
}

function clone() {
  if [[ -z $2 ]]; then
    git clone "$@" && cd "$(basename "$1" .git)"
  else
    git clone "$@" && cd "$2"
  fi
}

function clonep() {
  proj && clone "$@" && code . && cd -
}

function codep() {
  proj && code "$@" && cd -
}
function serve() {
  if [[ -z $1 ]] then
    live-server dist
  else
    live-server "$1"
  fi
}


# nvm
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
elif [ -s "/usr/share/nvm/nvm.sh" ]; then
  . "/usr/share/nvm/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  . "/opt/homebrew/opt/nvm/nvm.sh"
fi

if [ -f "$NVM_DIR/bash_completion" ]; then
  . "$NVM_DIR/bash_completion"
elif [ -f "/usr/share/nvm/bash_completion" ]; then
  . "/usr/share/nvm/bash_completion"
fi

# locale
export LANG=en_US.UTF-8

alias e='exit'
alias cl='clear'
alias n='nvim'
alias ze='zellij'
alias ff='fastfetch'
alias lg='lazygit'

# Modern CLI replacements
if command -v bat &>/dev/null; then
  alias cat='bat --style=header,grid,numbers --paging=never'
fi
if command -v fd &>/dev/null; then
  alias find='fd'
fi
if command -v tldr &>/dev/null; then
  alias help='tldr'
fi

# eza
alias ls='eza --icons --group-directories-first'
alias l='eza -1 --icons --group-directories-first'
alias ll='eza -lh --icons --git --group-directories-first'
alias la='eza -lah --icons --git --group-directories-first'
alias lt='eza --tree --level=2 --icons --group-directories-first'
alias lm='eza -lah --icons --git --sort=modified'
alias lmd='eza -lah --icons --git --sort=modified --reverse'

# Node Package Manager (ni / nr)
if command -v nr &>/dev/null; then
  alias d="nr dev"
  alias b="nr build"
  alias t="nr test"
  alias c="nr typecheck"
  alias lint="nr lint"
fi

function y() {
	local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
	yazi "$@" --cwd-file="$tmp"
	if cwd="$(command cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
		builtin cd -- "$cwd"
	fi
	rm -f -- "$tmp"
}

eval "$(zoxide init zsh)"

if command -v fd &>/dev/null; then
  export FZF_DEFAULT_COMMAND='fd --type f --hidden --exclude .git'
  export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
fi

export FZF_DEFAULT_OPTS="$FZF_DEFAULT_OPTS \
  --highlight-line \
  --info=inline-right \
  --ansi \
  --layout=reverse \
  --border=none
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
# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Local binary PATH
export PATH="$HOME/.local/bin:$PATH"
