# zsh.d/os/debian.zsh - Debian / Ubuntu 环境专属配置

# 剪贴板适配
function gsha() {
    local sha="$(git rev-parse HEAD 2>/dev/null)"
    if [[ -z "$sha" ]]; then
        echo "当前不在 Git 仓库中"
        return 1
    fi

    if command -v wl-copy &>/dev/null; then
        echo -n "$sha" | wl-copy
    elif command -v xclip &>/dev/null; then
        echo -n "$sha" | xclip -selection clipboard
    else
        echo "$sha"
    fi
}
