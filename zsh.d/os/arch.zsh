# zsh.d/os/arch.zsh - Arch Linux & WSL 环境专属配置

# 剪贴板适配 (优先检测 Windows WSL clip.exe，其次 Wayland wl-copy，最后 X11 xclip)
function gsha() {
    local sha="$(git rev-parse HEAD 2>/dev/null)"
    if [[ -z "$sha" ]]; then
        echo "当前不在 Git 仓库中"
        return 1
    fi

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
