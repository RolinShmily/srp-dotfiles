# zsh.d/os/termux.zsh - Android Termux 环境专属配置

# Termux 剪贴板适配 (termux-clipboard-set)
function gsha() {
    local sha="$(git rev-parse HEAD 2>/dev/null)"
    if [[ -z "$sha" ]]; then
        echo "当前不在 Git 仓库中"
        return 1
    fi

    if command -v termux-clipboard-set &>/dev/null; then
        echo -n "$sha" | termux-clipboard-set
    else
        echo "$sha"
    fi
}
