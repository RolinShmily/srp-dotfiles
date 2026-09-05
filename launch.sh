#!/usr/bin/env bash

# ==============================================================================
# launch.sh - SrP-Dotfiles Unix 统一环境一键管理总控引擎
# 集成: 交互式启动菜单 (Launch) + 依赖安装 (Install) + 符号链接部署与备份 (Config)
# 特性: 遇错拦截询问 (重试/跳过/终止) + 执行审计账本 + 部署汇总报告
# 配置清单来源: manifest.toml [arch / debian / termux]
# ==============================================================================

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_FILE="$DOTFILES_DIR/manifest.toml"
BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"

GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
BOLD="\033[1m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${RESET} $1"; }
log_error() { echo -e "${RED}[ERROR]${RESET} $1"; }

# ------------------------------------------------------------------
# 0. 全局执行账本与受控步骤执行器 (Step Runner)
# ------------------------------------------------------------------
declare -a REPORT_SUCCESS=()
declare -a REPORT_SKIPPED=()
declare -a REPORT_FAILED=()

run_step() {
    local step_name="$1"
    shift

    while true; do
        log_info "正在执行: ${BOLD}$step_name${RESET} ..."
        set +e
        "$@"
        local status=$?
        set -e

        if [ $status -eq 0 ]; then
            REPORT_SUCCESS+=("$step_name")
            return 0
        fi

        log_error "步骤 [${BOLD}$step_name${RESET}] 执行失败 (退出码: $status)！"

        # 非交互式终端环境下自动记录并跳过
        if [ ! -t 0 ]; then
            log_warn "检测到非交互终端，已自动跳过此步骤。"
            REPORT_SKIPPED+=("$step_name (自动跳过: 退出码 $status)")
            return 1
        fi

        echo -e "${YELLOW}----------------------------------------------------${RESET}"
        echo -e " 遇到执行异常，请选择后续处理方式："
        echo -e "   ${BOLD}[s]${RESET} 跳过此步并继续 (Skip) ${GREEN}[推荐/默认]${RESET}"
        echo -e "   ${BOLD}[r]${RESET} 重试此步骤 (Retry)"
        echo -e "   ${BOLD}[a]${RESET} 终止并退出 (Abort)"
        echo -e "${YELLOW}----------------------------------------------------${RESET}"
        read -rp " 请选择 [s/r/a, 默认 s]: " user_choice
        user_choice="${user_choice:-s}"

        case "$user_choice" in
            [sS]*)
                log_warn "已手动跳过步骤: $step_name"
                REPORT_SKIPPED+=("$step_name (手动跳过: 退出码 $status)")
                return 1
                ;;
            [rR]*)
                log_info "正在重试步骤: $step_name ..."
                continue
                ;;
            [aA]*)
                log_error "用户主动终止安装部署流程。"
                REPORT_FAILED+=("$step_name (用户中止: 退出码 $status)")
                print_summary_report
                exit 1
                ;;
            *)
                log_warn "输入无法识别，默认跳过此步骤。"
                REPORT_SKIPPED+=("$step_name (手动跳过: 退出码 $status)")
                return 1
                ;;
        esac
    done
}

print_summary_report() {
    echo -e "\n${CYAN}================================================================${RESET}"
    echo -e "${BOLD}              📊 SrP-Dotfiles 安装与部署审计报告               ${RESET}"
    echo -e "${CYAN}================================================================${RESET}"

    local total_success=${#REPORT_SUCCESS[@]}
    local total_skipped=${#REPORT_SKIPPED[@]}
    local total_failed=${#REPORT_FAILED[@]}

    echo -e " 🎯 目标操作系统: ${GREEN}${BOLD}${TARGET_OS}${RESET} | 硬件架构: ${YELLOW}${ARCH}${RESET}"
    if [ "$IS_WSL" = "yes" ]; then
        echo -e " 💻 WSL 宿主环境: ${GREEN}是 (WSL)${RESET}"
    fi
    echo -e " ⏱️ 报告生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "${CYAN}----------------------------------------------------------------${RESET}"

    # 1. 成功列表
    if [ $total_success -gt 0 ]; then
        echo -e "${GREEN}${BOLD}✔ 成功完成 ($total_success 项):${RESET}"
        for item in "${REPORT_SUCCESS[@]}"; do
            echo -e "  ${GREEN}✓${RESET} $item"
        done
    else
        echo -e "${YELLOW}ℹ 没有成功完成的项目。${RESET}"
    fi

    # 2. 跳过列表
    if [ $total_skipped -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}${BOLD}⚠ 跳过/忽略项目 ($total_skipped 项):${RESET}"
        for item in "${REPORT_SKIPPED[@]}"; do
            echo -e "  ${YELLOW}-${RESET} $item"
        done
    fi

    # 3. 失败列表
    if [ $total_failed -gt 0 ]; then
        echo ""
        echo -e "${RED}${BOLD}✖ 失败/中止项目 ($total_failed 项):${RESET}"
        for item in "${REPORT_FAILED[@]}"; do
            echo -e "  ${RED}✗${RESET} $item"
        done
    fi

    echo -e "${CYAN}----------------------------------------------------------------${RESET}"
    if [ $total_skipped -gt 0 ] || [ $total_failed -gt 0 ]; then
        echo -e " 💡 ${BOLD}提示:${RESET} 针对跳过或未完成的项目，您可以在排查网络/依赖后单独重试："
        echo -e "    - 重新安装依赖: ${CYAN}./launch.sh install${RESET}"
        echo -e "    - 重新部署配置: ${CYAN}./launch.sh config${RESET}"
    else
        echo -e " 🎉 ${GREEN}${BOLD}恭喜！所有安装与部署项目均完美就绪！${RESET}"
    fi
    echo -e "${CYAN}================================================================${RESET}"
}

# ------------------------------------------------------------------
# 1. 零依赖 TOML 解析器 (纯 Awk 实现)
# ------------------------------------------------------------------
parse_toml_val() {
    local section="$1"
    local key="$2"
    local file="$3"
    awk -v target_sec="[$section]" -v target_key="$key" '
        /^[ \t]*#/ { next }
        $0 ~ "^[ \t]*\\[" {
            clean = $0
            gsub(/[ \t]/, "", clean)
            in_sec = (clean == target_sec)
        }
        in_sec && $0 ~ "^[ \t]*" target_key "[ \t]*=" {
            idx = index($0, "=")
            val = substr($0, idx + 1)
            sub(/^[ \t]*/, "", val)
            sub(/[ \t\r\n]*$/, "", val)
            gsub(/(^"|"$)/, "", val)
            print val
            exit
        }
    ' "$file"
}

parse_toml_array() {
    local section="$1"
    local key="$2"
    local file="$3"
    awk -v target_sec="[$section]" -v target_key="$key" '
        /^[ \t]*#/ { next }
        $0 ~ "^[ \t]*\\[" {
            clean = $0
            gsub(/[ \t]/, "", clean)
            in_sec = (clean == target_sec)
        }
        in_sec && $0 ~ "^[ \t]*" target_key "[ \t]*=" {
            in_arr = 1
            idx = index($0, "=")
            line = substr($0, idx + 1)
        }
        in_arr {
            if (line == "") line = $0
            while (match(line, /"[^"]*"/)) {
                item = substr(line, RSTART + 1, RLENGTH - 2)
                if (item != "") print item
                line = substr(line, RSTART + RLENGTH)
            }
            if ($0 ~ /\]/) {
                in_arr = 0
                exit
            }
            line = ""
        }
    ' "$file"
}

# ------------------------------------------------------------------
# 2. 操作系统与环境探测
# ------------------------------------------------------------------
detect_os() {
    if [ -d "/data/data/com.termux" ]; then
        echo "termux"
    elif [ -f /etc/os-release ]; then
        if grep -qi "arch" /etc/os-release; then
            echo "arch"
        elif grep -qiE "debian|ubuntu" /etc/os-release; then
            echo "debian"
        else
            echo "arch"
        fi
    elif [ -f /etc/arch-release ]; then
        echo "arch"
    elif [ -f /etc/debian_version ]; then
        echo "debian"
    else
        echo "arch"
    fi
}

detect_wsl() {
    if [ -f /proc/version ] && grep -qi "microsoft" /proc/version 2>/dev/null; then
        echo "yes"
    else
        echo "no"
    fi
}

TARGET_OS="$(detect_os)"
IS_WSL="$(detect_wsl)"
ARCH="$(uname -m)"
ACTION=""
FORCE=0

# ------------------------------------------------------------------
# 3. 模块一：环境与软件包检测安装 (Install)
# ------------------------------------------------------------------
do_install_sys_packages() {
    local pm="$1"
    shift
    local -a pkgs=("$@")

    case "$TARGET_OS" in
        arch)
            sudo pacman -Syu --needed --noconfirm "${pkgs[@]}"
            ;;
        debian)
            sudo apt-get update -y && sudo apt-get install -y "${pkgs[@]}"
            ;;
        termux)
            pkg update -y && pkg install -y "${pkgs[@]}"
            ;;
        *)
            log_warn "未知的操作系统类型: $TARGET_OS，跳过系统包安装。"
            ;;
    esac
}

set_default_shell() {
    if ! command -v zsh &>/dev/null; then
        return 0
    fi
    local zsh_path
    zsh_path="$(which zsh)"

    if [ "$TARGET_OS" != "termux" ]; then
        if ! grep -q "^${zsh_path}$" /etc/shells 2>/dev/null; then
            echo "$zsh_path" | sudo tee -a /etc/shells >/dev/null 2>&1 || true
        fi
        local current_user="${USER:-$(whoami)}"
        if [ "$SHELL" != "$zsh_path" ]; then
            sudo chsh -s "$zsh_path" "$current_user" 2>/dev/null || chsh -s "$zsh_path" 2>/dev/null || true
        fi
    else
        if [ "$SHELL" != "$zsh_path" ]; then
            chsh -s "$zsh_path" 2>/dev/null || true
        fi
    fi
}

do_install_omz() {
    if [ ! -d "$HOME/.oh-my-zsh" ]; then
        env RUNZSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || true
    fi
}

do_install_single_npm() {
    local pkg_name="$1"
    if ! command -v npm &>/dev/null; then
        log_warn "未检测到 npm，跳过: $pkg_name"
        return 1
    fi
    if [ "$TARGET_OS" = "termux" ]; then
        npm install -g --ignore-scripts "$pkg_name"
    else
        sudo npm install -g --ignore-scripts "$pkg_name" 2>/dev/null || npm install -g --ignore-scripts "$pkg_name"
    fi
}

do_install_single_skill() {
    local skill_item="$1"
    local agent_param=""
    if [[ ! "$skill_item" =~ (-a|--agent) ]]; then
        agent_param="-a pi"
    fi

    if command -v skills &>/dev/null; then
        skills add $skill_item $agent_param -g -y
    elif command -v npx &>/dev/null; then
        npx --yes skills add $skill_item $agent_param -g -y
    else
        log_warn "未检测到 skills 或 npx 命令，跳过技能安装: $skill_item"
        return 1
    fi
}

run_install() {
    echo -e "${BLUE}====================================================${RESET}"
    echo -e "${BOLD}       📦 执行 Unix 系统依赖安装 ($TARGET_OS)       ${RESET}"
    echo -e "${BLUE}====================================================${RESET}"

    if [ ! -f "$MANIFEST_FILE" ]; then
        log_error "未找到清单文件: $MANIFEST_FILE"
        exit 1
    fi

    local package_manager
    package_manager="$(parse_toml_val "$TARGET_OS" "package_manager" "$MANIFEST_FILE")"
    readarray -t pkgs < <(parse_toml_array "$TARGET_OS" "packages" "$MANIFEST_FILE")
    readarray -t npm_globals < <(parse_toml_array "$TARGET_OS" "npm_globals" "$MANIFEST_FILE")
    readarray -t skills_add < <(parse_toml_array "$TARGET_OS" "skills_add" "$MANIFEST_FILE")

    # 1. 系统核心包
    if [ ${#pkgs[@]} -gt 0 ]; then
        run_step "安装系统基础依赖 ($package_manager - ${#pkgs[@]} 个包)" do_install_sys_packages "$package_manager" "${pkgs[@]}"
    fi

    # 2. 默认 Shell
    run_step "配置默认 Shell 为 zsh" set_default_shell

    # 3. Oh My Zsh
    run_step "安装 Oh My Zsh 基础框架" do_install_omz

    # 4. 全局 npm 包 (逐个执行，失败可独立跳过)
    if [ ${#npm_globals[@]} -gt 0 ]; then
        for npm_pkg in "${npm_globals[@]}"; do
            [ -z "$npm_pkg" ] && continue
            run_step "全局 npm 依赖 [$npm_pkg]" do_install_single_npm "$npm_pkg"
        done
    fi

    # 5. Agent Skills (逐个执行，失败可独立跳过)
    if [ ${#skills_add[@]} -gt 0 ]; then
        for skill_item in "${skills_add[@]}"; do
            skill_item="$(echo "$skill_item" | xargs)"
            [ -z "$skill_item" ] && continue
            run_step "Agent 技能 [$skill_item]" do_install_single_skill "$skill_item"
        done
    fi
}

# ------------------------------------------------------------------
# 4. 模块二：符号链接配置部署与安全备份 (Config)
# ------------------------------------------------------------------
link_file() {
    local src="$1"
    local dest="$2"

    if [ ! -e "$src" ]; then
        log_warn "源文件/目录不存在，跳过: $src"
        return 1
    fi

    mkdir -p "$(dirname "$dest")"

    if [ -L "$dest" ]; then
        local current_target
        current_target="$(readlink "$dest")"
        if [ "$current_target" = "$src" ]; then
            log_info "软链接已正确指向: $dest"
            return 0
        else
            log_warn "更新现有的软链接: $dest"
            rm "$dest"
        fi
    elif [ -e "$dest" ]; then
        if [ "$FORCE" -eq 1 ]; then
            log_warn "[强制模式] 删除现有非链接文件/目录: $dest"
            rm -rf "$dest"
        else
            mkdir -p "$BACKUP_DIR/$(dirname "${dest#$HOME/}")"
            log_warn "备份现有非链接文件: $dest -> $BACKUP_DIR/${dest#$HOME/}"
            mv "$dest" "$BACKUP_DIR/${dest#$HOME/}"
        fi
    fi

    ln -s "$src" "$dest"
    log_success "已创建软链接: $dest -> $src"
}

setup_omz_plugins() {
    if [ -d "$HOME/.oh-my-zsh" ]; then
        local custom_dir="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
        mkdir -p "$custom_dir/plugins" "$custom_dir/themes"

        if [ ! -d "$custom_dir/plugins/zsh-autosuggestions" ]; then
            git clone https://github.com/zsh-users/zsh-autosuggestions "$custom_dir/plugins/zsh-autosuggestions" || true
        fi

        if [ ! -d "$custom_dir/plugins/zsh-syntax-highlighting" ]; then
            git clone https://github.com/zsh-users/zsh-syntax-highlighting "$custom_dir/plugins/zsh-syntax-highlighting" || true
        fi

        if [ ! -d "$custom_dir/themes/spaceship-prompt" ]; then
            git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$custom_dir/themes/spaceship-prompt" --depth=1 || true
            ln -sf "$custom_dir/themes/spaceship-prompt/spaceship.zsh-theme" "$custom_dir/themes/spaceship.zsh-theme" || true
        fi
    fi
}

deploy_pi_extensions() {
    local extensions_dir="$1"
    local source_dir="$DOTFILES_DIR/pi/extensions"
    local -a pi_exts=("${@:2}")

    [ -d "$source_dir" ] || return 0

    local source_real
    source_real="$(cd "$source_dir" 2>/dev/null && pwd -P)"

    if [ -L "$extensions_dir" ]; then
        local legacy_target
        legacy_target="$(readlink -f "$extensions_dir" 2>/dev/null || true)"
        if [ "$legacy_target" = "$source_real" ]; then
            rm -f "$extensions_dir"
            mkdir -p "$extensions_dir"
        else
            return 0
        fi
    else
        mkdir -p "$extensions_dir"
    fi

    declare -A wanted_extensions=()
    for ext in "${pi_exts[@]}"; do
        wanted_extensions["$ext"]=1
    done

    while IFS= read -r -d '' destination; do
        local target
        target="$(readlink -f "$destination" 2>/dev/null || true)"
        case "$target" in
            "$source_real"/*)
                local ext_name="${destination##*/}"
                if [ -z "${wanted_extensions[$ext_name]}" ]; then
                    rm -f "$destination"
                fi
                ;;
        esac
    done < <(find "$extensions_dir" -mindepth 1 -maxdepth 1 -type l -print0)

    for extension in "${pi_exts[@]}"; do
        local source="$source_dir/$extension"
        local destination="$extensions_dir/$extension"
        [ -e "$source" ] || continue
        if [ -L "$destination" ]; then
            local current_target
            current_target="$(readlink "$destination" 2>/dev/null || true)"
            [ "$current_target" = "$source" ] && continue
            rm -f "$destination"
        elif [ -e "$destination" ]; then
            continue
        fi
        mkdir -p "$(dirname "$destination")"
        ln -s "$source" "$destination"
    done
}

deploy_pi_resources() {
    local res_type="$1"
    local res_label="$2"
    local dest_dir="$3"
    local source_dir="$DOTFILES_DIR/pi/$res_type"

    [ -d "$source_dir" ] || return 0

    local source_real
    source_real="$(cd "$source_dir" 2>/dev/null && pwd -P)"

    if [ -L "$dest_dir" ]; then
        local legacy_target
        legacy_target="$(readlink -f "$dest_dir" 2>/dev/null || true)"
        if [ "$legacy_target" = "$source_real" ]; then
            rm -f "$dest_dir"
            mkdir -p "$dest_dir"
        else
            return 0
        fi
    else
        mkdir -p "$dest_dir"
    fi

    while IFS= read -r -d '' destination; do
        local target
        target="$(readlink -f "$destination" 2>/dev/null || true)"
        case "$target" in
            "$source_real"/*)
                if [ ! -e "$target" ]; then
                    rm -f "$destination"
                fi
                ;;
        esac
    done < <(find "$dest_dir" -mindepth 1 -maxdepth 1 -type l -print0)

    for item in "$source_dir"/*; do
        [ -e "$item" ] || continue
        local item_name="${item##*/}"
        local destination="$dest_dir/$item_name"
        if [ -L "$destination" ]; then
            local current_target
            current_target="$(readlink "$destination" 2>/dev/null || true)"
            [ "$current_target" = "$item" ] && continue
            rm -f "$destination"
        elif [ -e "$destination" ]; then
            continue
        fi
        ln -s "$item" "$destination"
    done
}

do_deploy_pi_stack() {
    local -a pi_pkgs=("${!1}")
    local -a pi_exts=("${!2}")

    local pi_agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
    mkdir -p "$pi_agent_dir"

    if ! command -v node &>/dev/null; then
        log_error "部署 Pi 配置需要 node 命令来安全合并 JSON。"
        return 1
    fi

    node "$DOTFILES_DIR/scripts/merge_pi_settings.js" \
        "$pi_agent_dir/settings.json" \
        "$DOTFILES_DIR/pi/settings.json.example" \
        "$BACKUP_DIR" \
        "${pi_pkgs[@]}"

    [ -f "$DOTFILES_DIR/pi/AGENTS.md" ] && link_file "$DOTFILES_DIR/pi/AGENTS.md" "$pi_agent_dir/AGENTS.md"
    deploy_pi_extensions "$pi_agent_dir/extensions" "${pi_exts[@]}"
    deploy_pi_resources "skills" "技能" "$pi_agent_dir/skills"
    deploy_pi_resources "prompts" "提示词" "$pi_agent_dir/prompts"
    deploy_pi_resources "agents" "智能体" "$pi_agent_dir/agents"
}

do_deploy_termux_font() {
    if [ ! -f "$HOME/.termux/font.ttf" ]; then
        mkdir -p "$HOME/.termux"
        curl -fsSL -o "$HOME/.termux/font.ttf" "https://raw.githubusercontent.com/romkatv/powerlevel10k-media/master/MesloLGS%20NF%20Regular.ttf"
        if command -v termux-reload-settings &>/dev/null; then
            termux-reload-settings || true
        fi
    fi
}

run_config() {
    echo -e "${BLUE}====================================================${RESET}"
    echo -e "${BOLD}       ⚙️ 执行 Unix 配置文件部署 ($TARGET_OS)       ${RESET}"
    echo -e "${BLUE}====================================================${RESET}"

    if [ ! -f "$MANIFEST_FILE" ]; then
        log_error "未找到清单文件: $MANIFEST_FILE"
        exit 1
    fi

    log_info "目标配置环境: ${GREEN}${TARGET_OS}${RESET}"
    [ "$FORCE" -eq 1 ] && log_info "已开启强制覆盖模式 (-f / --force)。"

    # 1. Oh My Zsh 插件与 Spaceship 主题
    run_step "部署 Oh My Zsh 插件与 Spaceship 主题" setup_omz_plugins

    # 2. 用户家目录基础文件 (~/.zshrc, ~/.vimrc)
    run_step "部署 ~/.zshrc 配置文件" link_file "$DOTFILES_DIR/.zshrc" "$HOME/.zshrc"
    if [ -f "$DOTFILES_DIR/.vimrc" ]; then
        run_step "部署 ~/.vimrc 配置文件" link_file "$DOTFILES_DIR/.vimrc" "$HOME/.vimrc"
    fi

    # 3. 读取 manifest.toml 部署应用配置目录
    readarray -t config_apps < <(parse_toml_array "$TARGET_OS" "configs" "$MANIFEST_FILE")
    readarray -t pi_packages < <(parse_toml_array "$TARGET_OS" "pi_packages" "$MANIFEST_FILE")
    readarray -t pi_extensions < <(parse_toml_array "$TARGET_OS" "pi_extensions" "$MANIFEST_FILE")

    for app in "${config_apps[@]}"; do
        if [ "$app" = "pi" ]; then
            run_step "部署 Pi Coding Agent 规则/扩展/技能体系" do_deploy_pi_stack pi_packages[@] pi_extensions[@]
        else
            if [ -d "$DOTFILES_DIR/$app" ]; then
                run_step "部署 [$app] 配置文件软链接" link_file "$DOTFILES_DIR/$app" "$HOME/.config/$app"
            else
                log_warn "未在仓库中找到配置目录: $DOTFILES_DIR/$app"
            fi
        fi
    done

    # 4. Termux 专属字体与外观适配
    if [ "$TARGET_OS" = "termux" ]; then
        run_step "部署 Termux Nerd Font (MesloLGS NF) 字体" do_deploy_termux_font
    fi
}

# ------------------------------------------------------------------
# 5. CLI 帮助信息
# ------------------------------------------------------------------
show_help() {
    echo -e "${BOLD}SrP-Dotfiles Unix 统一管理引擎 (launch.sh)${RESET}

${BOLD}用法:${RESET}
  $0 [子命令] [操作系统] [选项]

${BOLD}子命令:${RESET}
  all                  安装依赖并部署配置 (默认推荐流水线)
  install              仅通过系统包管理器安装环境依赖 (Pacman / Apt / Pkg)
  config               仅部署并同步 Dotfiles 软链接配置
  launch               启动交互式彩色菜单 (无参数时的默认行为)
  help, -h, --help     显示本帮助信息

${BOLD}支持的操作系统参数:${RESET}
  arch                 Arch Linux / Manjaro / WSL Arch (默认检测)
  debian               Debian / Ubuntu / 服务器环境
  termux               Android Termux 环境

${BOLD}选项:${RESET}
  -f, --force          部署配置时强制覆盖现有文件
  --os <type>          显式指定操作系统 (arch | debian | termux)

${BOLD}异常处理机制:${RESET}
  当安装或部署遇到错误时，脚本会自动拦截并提供 [s] 跳过 / [r] 重试 / [a] 终止，
  并在执行结束时生成完整的《安装与部署审计报告》。

${BOLD}示例:${RESET}
  $0                   # 启动交互式控制台菜单
  $0 all               # 自动探测系统并全自动完成安装与配置
  $0 install arch      # 为 Arch 系统安装依赖
  $0 config -f         # 强制覆盖部署配置文件"
}

# ------------------------------------------------------------------
# 6. CLI 参数解析
# ------------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        all|install|config|launch)
            ACTION="$1"
            shift
            ;;
        arch|debian|termux)
            TARGET_OS="$1"
            shift
            ;;
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=1
            shift
            ;;
        -h|--help|help)
            show_help
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

# 如果指定了明确的命令行动作且不是 launch，则直接非交互式执行
if [ -n "$ACTION" ] && [ "$ACTION" != "launch" ]; then
    case "$ACTION" in
        all)
            run_install
            echo ""
            run_config
            print_summary_report
            ;;
        install)
            run_install
            print_summary_report
            ;;
        config)
            run_config
            print_summary_report
            ;;
    esac
    exit 0
fi

# ------------------------------------------------------------------
# 7. 交互式启动菜单 (无参数直接运行时)
# ------------------------------------------------------------------
echo -e "${CYAN}====================================================${RESET}"
echo -e "${BOLD}       🚀 欢迎使用 SrP-Dotfiles 一键配置管理器      ${RESET}"
echo -e "${CYAN}====================================================${RESET}"
echo -e " 🖥️ 检测到操作系统: ${GREEN}${BOLD}${TARGET_OS}${RESET}"
echo -e " ⚙️ 硬件架构:       ${YELLOW}${ARCH}${RESET}"
if [ "$IS_WSL" = "yes" ]; then
    echo -e " 💻 WSL 环境:       ${GREEN}是 (WSL)${RESET}"
fi
echo -e " 📄 规则清单文件:   ${CYAN}${MANIFEST_FILE}${RESET}"
echo -e "${CYAN}----------------------------------------------------${RESET}"
echo -e " 请选择要执行的操作："
echo -e "   ${BOLD}1)${RESET} 全部执行 (安装系统依赖 + 部署配置文件) ${GREEN}[推荐/默认]${RESET}"
echo -e "   ${BOLD}2)${RESET} 仅安装系统依赖 (Install Packages)"
echo -e "   ${BOLD}3)${RESET} 仅部署配置文件 (Deploy Configs)"
echo -e "   ${BOLD}4)${RESET} 切换/指定操作系统 (当前: ${TARGET_OS})"
echo -e "   ${BOLD}0)${RESET} 退出"
echo -e "${CYAN}----------------------------------------------------${RESET}"
read -rp " 请输入选项 [1/2/3/4/0, 默认 1]: " choice
choice="${choice:-1}"

case "$choice" in
    1)
        run_install
        echo ""
        run_config
        print_summary_report
        ;;
    2)
        run_install
        print_summary_report
        ;;
    3)
        read -rp " 是否开启强制覆盖模式 (-f)? [y/N]: " force_choice
        if [[ "$force_choice" =~ ^[Yy]$ ]]; then
            FORCE=1
        fi
        run_config
        print_summary_report
        ;;
    4)
        echo ""
        echo "可选操作系统列表:"
        echo "  1) arch   (Arch Linux / WSL)"
        echo "  2) debian (Debian 13 / Ubuntu / 服务器)"
        echo "  3) termux (Android Termux)"
        read -rp "请选择编号 [1-3]: " os_choice
        case "$os_choice" in
            1) TARGET_OS="arch" ;;
            2) TARGET_OS="debian" ;;
            3) TARGET_OS="termux" ;;
            *) log_error "无效的选择: $os_choice"; exit 1 ;;
        esac
        echo -e "已切换操作系统为: ${GREEN}${TARGET_OS}${RESET}"
        run_install
        echo ""
        run_config
        print_summary_report
        ;;
    0)
        log_info "已安全退出。"
        exit 0
        ;;
    *)
        log_error "无效的选项: $choice"
        exit 1
        ;;
esac
