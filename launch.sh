#!/usr/bin/env bash

# ==============================================================================
# launch.sh - SrP-Dotfiles Unix 统一环境一键管理总控引擎
# 集成: 交互式启动菜单 (Launch) + 依赖安装 (Install) + 符号链接部署与备份 (Config)
# 特性: 遇错拦截询问 (重试/跳过/终止) + 执行审计账本 + 部署汇总报告
# 配置清单来源: manifest.json [arch / debian / termux]
#
# 章节索引 (与 start.ps1 逐节对齐，便于两边对照阅读)
#   0. 全局执行账本与受控步骤执行器    1. 声明清单读取    2. 操作系统与环境探测
#   3. 模块一：环境与软件包检测安装    4. 模块二：配置部署 (只做派发)
#   5. CLI 帮助信息                    6. CLI 参数解析    7. 交互式启动菜单
# ==============================================================================

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_FILE="$DOTFILES_DIR/manifest.json"
MANIFEST_JS="$DOTFILES_DIR/scripts/lib/manifest.js"
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

# 让 scripts/configs/*.sh 子进程也能用到日志与上下文
export -f log_info log_success log_warn log_error

# ------------------------------------------------------------------
# 0. 全局执行账本与受控步骤执行器 (Step Runner & Two-Stage Interrupt)
# ------------------------------------------------------------------
declare -a REPORT_SUCCESS=()
declare -a REPORT_SKIPPED=()
declare -a REPORT_FAILED=()

LAST_CTRL_C_TIME=0
CURRENT_STEP_NAME=""
STEP_INTERRUPTED=0

handle_sigint() {
    local now
    now=$(date +%s%3N 2>/dev/null || date +%s)
    local diff=$(( now - LAST_CTRL_C_TIME ))

    if [ "$diff" -le 1200 ] && [ "$LAST_CTRL_C_TIME" -gt 0 ]; then
        echo -e "\n${RED}[ABORT] 连续检测到 Ctrl+C，已彻底终止安装部署流程！${RESET}"
        if [ -n "$CURRENT_STEP_NAME" ]; then
            REPORT_FAILED+=("$CURRENT_STEP_NAME (用户连续 Ctrl+C 终止)")
        fi
        print_summary_report
        exit 130
    else
        LAST_CTRL_C_TIME=$now
        STEP_INTERRUPTED=1
        echo -e "\n${YELLOW}[SKIP] 已手动中断当前步骤: ${BOLD}${CURRENT_STEP_NAME}${RESET}${YELLOW} (1秒内再次按下 Ctrl+C 将彻底退出脚本)${RESET}"
    fi
}
trap handle_sigint INT TERM

run_step() {
    local step_name="$1"
    shift
    CURRENT_STEP_NAME="$step_name"
    STEP_INTERRUPTED=0

    while true; do
        log_info "正在执行: ${BOLD}$step_name${RESET} ..."
        set +e
        "$@"
        local status=$?
        set -e

        # 如果被单次 Ctrl+C 打断
        if [ "$STEP_INTERRUPTED" -eq 1 ] || [ $status -eq 130 ]; then
            STEP_INTERRUPTED=0
            REPORT_SKIPPED+=("$step_name (手动中断跳过)")
            CURRENT_STEP_NAME=""
            return 0
        fi

        if [ $status -eq 0 ]; then
            REPORT_SUCCESS+=("$step_name")
            CURRENT_STEP_NAME=""
            return 0
        fi

        log_error "步骤 [${BOLD}$step_name${RESET}] 执行失败 (退出码: $status)！"

        # 非交互式终端环境下自动记录并跳过
        if [ ! -t 0 ]; then
            log_warn "检测到非交互终端，已自动跳过此步骤。"
            REPORT_SKIPPED+=("$step_name (自动跳过: 退出码 $status)")
            CURRENT_STEP_NAME=""
            return 0
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
                CURRENT_STEP_NAME=""
                return 0
                ;;
            [rR]*)
                log_info "正在重试步骤: $step_name ..."
                STEP_INTERRUPTED=0
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
                CURRENT_STEP_NAME=""
                return 0
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
# 1. 声明清单读取 (唯一事实源: manifest.json)
# ------------------------------------------------------------------
_need_node() {
    command -v node >/dev/null 2>&1 && return 0
    log_error "读取 manifest.json 需要 node，但当前系统没有 node。"
    echo -e ""
    echo -e "  请先手动安装 node，然后重试："
    echo -e "    ${BOLD}Arch / WSL${RESET}        sudo pacman -S --needed nodejs npm"
    echo -e "    ${BOLD}Debian / Ubuntu${RESET}   sudo apt-get install -y nodejs npm"
    echo -e "    ${BOLD}Termux${RESET}            pkg install -y nodejs"
    echo -e ""
    echo -e "  ${YELLOW}注：install 与 config 均需先读清单，所以 node 是任何子命令的前置。${RESET}"
    exit 1
}

# 单值:   manifest_get  <os> <key>
# 数组:   manifest_get  <os> <key>   (逐行输出)
# 计划表: manifest_plan <os>         (TSV，每行一个 config 条目)
manifest_get()  { _need_node; node "$MANIFEST_JS" get  "$1" "$2"; }
manifest_plan() { _need_node; node "$MANIFEST_JS" plan "$1"; }

# 部署动词库: link_item / copy_item / expand_path / custom_script_path
source "$DOTFILES_DIR/scripts/lib/deploy.sh"

# ------------------------------------------------------------------
# 2. 运行环境探测
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
    # 只在整词形式的 -a / --agent 出现时才认为用户已指定 agent，
    # 否则 K-Dense-AI、tt-a1i 这类名字里的 "-a" 子串会被误判。
    if [[ ! "$skill_item" =~ (^|[[:space:]])(-a|--agent)([[:space:]]|$) ]]; then
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
    package_manager="$(manifest_get "$TARGET_OS" packageManager)"
    readarray -t pkgs        < <(manifest_get "$TARGET_OS" packages)
    readarray -t npm_globals < <(manifest_get "$TARGET_OS" npmGlobals)
    readarray -t skills_add  < <(manifest_get "$TARGET_OS" skillsAdd)

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
# 4. 模块二：配置部署 (Config - 只做派发)
# ------------------------------------------------------------------

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
        log_error "未找到声明清单: $MANIFEST_FILE"
        exit 1
    fi

    log_info "声明清单: ${CYAN}$MANIFEST_FILE${RESET}"
    log_info "目标配置环境: ${GREEN}${TARGET_OS}${RESET}"
    [ "$FORCE" -eq 1 ] && log_info "已开启强制覆盖模式 (-f / --force)。"

    # 子脚本 (scripts/configs/*.sh) 需要的上下文
    export DOTFILES_DIR BACKUP_DIR FORCE PI_MANIFEST_OS="$TARGET_OS"

    # 1. Oh My Zsh 插件与 Spaceship 主题
    run_step "部署 Oh My Zsh 插件与 Spaceship 主题" setup_omz_plugins

    # 2. 按 manifest.json 的 configs 秩序逐条派发
    local name method source targets exclude ifmissing when
    while IFS=$'\t' read -r name method source targets exclude ifmissing when; do
        [ -z "$name" ] && continue
        _dispatch_config "$name" "$method" "$source" "$targets" "$exclude" "$ifmissing" "$when"
    done < <(manifest_plan "$TARGET_OS")

    # 3. Termux 专属字体与外观适配
    if [ "$TARGET_OS" = "termux" ]; then
        run_step "部署 Termux Nerd Font (MesloLGS NF) 字体" do_deploy_termux_font
    fi
}

# 单条 config 的派发。只认三个动词: link / copy / custom
_dispatch_config() {
    local name="$1" method="$2" source="$3" targets="$4" exclude="$5" ifmissing="$6" when="$7"

    # when: 条件路径不存在则整条跳过（例如 Scoop 尚未安装 btop）
    if [ -n "$when" ]; then
        local when_path
        when_path="$(expand_path "$when")"
        if [ ! -e "$when_path" ]; then
            log_info "[$name] 条件未满足，跳过 ($when)"
            return 0
        fi
    fi

    case "$method" in
        custom)
            local script
            script="$(custom_script_path "$name")"
            if [ ! -f "$script" ]; then
                log_error "[$name] 找不到自定义部署脚本: $script"
                return 1
            fi
            run_step "[$name] 自定义部署" bash "$script"
            ;;

        link|copy)
            if [ ! -e "$(config_source_path "$source")" ]; then
                log_warn "[$name] 仓库内源不存在，跳过: $source"
                return 1
            fi

            local target_list
            target_list="$(printf '%s' "$targets" | tr '|' '\n')"
            if [ -z "$target_list" ]; then
                log_warn "[$name] 未声明 target/targets，跳过"
                return 1
            fi

            local t dest
            while IFS= read -r t; do
                [ -z "$t" ] && continue
                dest="$(expand_path "$t")"
                if [ "$method" = "link" ]; then
                    run_step "[$name] 链接 -> $t" link_item "$(config_source_path "$source")" "$dest" "$exclude"
                elif [[ "$source" == *.example ]]; then
                    run_step "[$name] 复制示例配置 -> $t" copy_example_item "$(config_source_path "$source")" "$dest" "$ifmissing"
                else
                    run_step "[$name] 复制 -> $t" copy_item "$(config_source_path "$source")" "$dest" "$ifmissing"
                fi
            done <<< "$target_list"
            ;;

        *)
            log_warn "[$name] 未知 method: $method（应为 link | copy | custom）"
            return 1
            ;;
    esac
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
