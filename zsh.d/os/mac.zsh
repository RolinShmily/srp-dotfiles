# zsh.d/os/mac.zsh - macOS (Homebrew) 环境专属配置

# Homebrew 环境变量初始化
if [ -x "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x "/usr/local/bin/brew" ]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

# macOS 剪贴板适配 (pbcopy)
function gsha() {
    local sha="$(git rev-parse HEAD 2>/dev/null)"
    if [[ -z "$sha" ]]; then
        echo "当前不在 Git 仓库中"
        return 1
    fi

    if command -v pbcopy &>/dev/null; then
        echo -n "$sha" | pbcopy
    else
        echo "$sha"
    fi
}
