# zsh.d/git.zsh - Git 别名与快捷函数

# -------------------------------- #
# Git 别名
# -------------------------------- #

# 跳转到 Git 仓库根目录
alias grt='cd "$(git rev-parse --show-toplevel)"'

alias gs='git status'
alias gp='git push'
alias gpf='git push --force'
alias gpft='git push --follow-tags'
alias gpl='git pull --rebase'
alias gcl='git clone'
alias gst='git stash'
alias grm='git rm'
alias grmc='git rm --cached'
alias gmv='git mv'
alias lg='lazygit'

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

alias ghci='gh run list -L 1'

# -------------------------------- #
# Git 函数
# -------------------------------- #

unalias glp 2>/dev/null
function glp() {
    if [[ -z $1 ]]; then
        git --no-pager log
    else
        git --no-pager log -n "$1"
    fi
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

unalias gd 2>/dev/null
function gd() {
    if command -v diff-so-fancy &>/dev/null; then
        if [[ -z $1 ]]; then
            git diff --color | diff-so-fancy
        else
            git diff --color "$1" | diff-so-fancy
        fi
    else
        git diff "$@"
    fi
}

unalias gdc 2>/dev/null
function gdc() {
    if command -v diff-so-fancy &>/dev/null; then
        if [[ -z $1 ]]; then
            git diff --color --cached | diff-so-fancy
        else
            git diff --color --cached "$1" | diff-so-fancy
        fi
    else
        git diff --cached "$@"
    fi
}

function gcfg() {
    if [[ -z "$1" || -z "$2" ]]; then
        echo "用法: gcfg <name> <email>"
        return 1
    fi
    git config --global user.name "$1"
    git config --global user.email "$2"
}

function gssh() {
    local key="$1"
    if [[ -z "$key" ]]; then
        local -a pubkeys
        pubkeys=($HOME/.ssh/*.pub(N))
        if [[ ${#pubkeys[@]} -gt 0 ]]; then
            key="${pubkeys[1]}"
        else
            echo "错误: 在 $HOME/.ssh/ 未找到任何 *.pub 密钥"
            return 1
        fi
    fi

    git config --global gpg.format ssh
    git config --global user.signingkey "$key"
    git config --global commit.gpgsign true
}

function ggpg() {
    if [[ -z "$1" ]]; then
        echo "用法: ggpg <key_id> (例如: ggpg 3AA5C34371567BD2)"
        echo ""
        echo "# 1. 打印密钥列表（查找 sec 后面的 Key ID）"
        echo "gpg --list-secret-keys --keyid-format=long"
        echo ""
        echo "# 2. 打印导出私钥（可附加特定 Key ID 或邮箱）"
        echo "gpg --armor --export-secret-keys"
        echo ""
        echo "# 3. 生成 GPG 密钥"
        echo "gpg --full-generate-key"
        return 1
    fi
    git config --global gpg.format gpg
    git config --global user.signingkey "$1"
    git config --global commit.gpgsign true
}

function pr() {
    if [[ "$1" == "ls" ]]; then
        gh pr list
    else
        gh pr checkout "$1"
    fi
}
