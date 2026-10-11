#!/usr/bin/env bash
# scripts/lib/deploy.sh — 部署动词库（Unix）。
#
# 只实现三个动词: link / copy / custom-脚本定位。
# 不负责编排、不负责账本 —— 那些属于入口脚本 (launch.sh)。
#
# 入口脚本必须先定义:
#   DOTFILES_DIR  仓库根绝对路径
#   BACKUP_DIR    备份目录
#   FORCE         1 = 强制覆盖, 0 = 备份后覆盖
#   log_info / log_warn / log_success / log_error

if ! command -v i18n >/dev/null 2>&1; then
    source "$(dirname "${BASH_SOURCE[0]}")/i18n.sh"
    set_i18n_language "${DF_LANG:-en}"
fi

# 展开 ~ 占位符
expand_path() {
    local p="$1"
    case "$p" in
        "~")   p="$HOME" ;;
        "~/"*) p="$HOME/${p#\~/}" ;;
    esac
    printf '%s' "$p"
}

# link/copy 的源统一解释为"仓库内相对路径"
config_source_path() {
    printf '%s/%s' "$DOTFILES_DIR" "$1"
}

# custom 条目的脚本路径
custom_script_path() {
    printf '%s/scripts/configs/%s.sh' "$DOTFILES_DIR" "$1"
}

# 归档或删除已有的非链接目标
_backup_target() {
    local dest="$1"

    if [ "$FORCE" = "1" ]; then
        log_warn "$(i18n deploy.force_delete "$dest")"
        rm -rf "$dest"
        return 0
    fi

    local rel="${dest#"$HOME"/}"
    rel="${rel#/}"
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    log_warn "$(i18n deploy.backup "$dest" "$BACKUP_DIR/$rel")"
    mv "$dest" "$BACKUP_DIR/$rel"
}

# 已存在且不是指向本仓库的链接 -> 先腾位置
_clear_destination() {
    local src="$1" dest="$2"

    if [ -L "$dest" ]; then
        if [ "$(readlink "$dest" 2>/dev/null)" = "$src" ]; then
            return 1   # 已是正确链接，无需动作
        fi
        log_warn "$(i18n deploy.update_link "$dest")"
        rm -f "$dest"
    elif [ -e "$dest" ]; then
        _backup_target "$dest"
    fi
    return 0
}

# link <源> <目标> [exclude_pipe]
# exclude_pipe: 用 | 分隔的顶层项名，命中则跳过（用于"目录链接但排除个别文件"）
link_item() {
    local src="$1" dest="$2" exclude="${3:-}"

    if [ ! -e "$src" ]; then
        log_warn "$(i18n deploy.source_missing "$src")"
        return 1
    fi

    mkdir -p "$(dirname "$dest")"

    # 目录 + 排除项: 建真实目录，逐项链接
    if [ -n "$exclude" ] && [ -d "$src" ]; then
        mkdir -p "$dest"
        local item bn
        for item in "$src"/*; do
            [ -e "$item" ] || continue
            bn="${item##*/}"
            case "|$exclude|" in
                *"|$bn|"*) log_info "$(i18n deploy.exclude "$bn")"; continue ;;
            esac
            link_item "$item" "$dest/$bn" || true
        done
        return 0
    fi

    if ! _clear_destination "$src" "$dest"; then
        log_info "$(i18n deploy.link_correct "$dest")"
        return 0
    fi

    ln -s "$src" "$dest"
    log_success "$(i18n deploy.linked "$dest" "$src")"
}

# copy <源> <目标> [if_missing]
# 覆盖式语义: 目标已存在则直接删除后复制，**不做备份**。
# ifMissing 是唯一的例外开关: 目标已存在就跳过（FORCE=1 时仍覆盖）。
copy_item() {
    local src="$1" dest="$2" if_missing="${3:-}"

    if [ ! -e "$src" ]; then
        log_warn "$(i18n deploy.source_missing "$src")"
        return 1
    fi

    if [ -n "$if_missing" ] && [ -e "$dest" ] && [ "$FORCE" != "1" ]; then
        log_info "$(i18n deploy.ifmissing "$dest")"
        return 0
    fi

    mkdir -p "$(dirname "$dest")"

    # 软链: 必须先删链接本身，否则 cp 会写穿到链接目标
    if [ -L "$dest" ]; then
        rm -f "$dest"
    fi

    # 文件→文件: 原地覆盖内容，保留目标 inode
    # (Scoop persist 等场景用硬链接实现，删后重建会打断链接导致应用读到旧文件)
    if [ -f "$src" ] && [ -f "$dest" ]; then
        cat "$src" > "$dest"
        log_success "$(i18n deploy.overwrite_file "$dest")"
        return 0
    fi

    # 其余情况: 删后重建 (源是目录时才能清掉多余文件)
    if [ -e "$dest" ]; then
        rm -rf "$dest"
    fi

    if [ -d "$src" ]; then
        cp -R "$src" "$dest"
    else
        cp "$src" "$dest"
    fi
    log_success "$(i18n deploy.overwrite "$dest")"
}

# .example 模板部署: 正式目标已存在时保留原文件，模板落到 <目标>.example；
# 正式目标不存在时直接以模板创建正式目标。
example_target_path() {
    local dest="$1"
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        printf '%s.example' "$dest"
    else
        printf '%s' "$dest"
    fi
}

copy_example_item() {
    local src="$1" dest="$2" if_missing="${3:-}" example_dest
    example_dest="$(example_target_path "$dest")"
    if [ "$example_dest" != "$dest" ]; then
        log_info "$(i18n deploy.example_existing "$example_dest")"
    else
        log_info "$(i18n deploy.example_missing "$dest")"
    fi
    copy_item "$src" "$example_dest" "$if_missing"
}
