#!/usr/bin/env bash

# launch.sh - SrP-Dotfiles 统一交互式启动与环境检测总入口

set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
BOLD="\033[1m"
RESET="\033[0m"

# ------------------------------------------------------------------
# 1. 运行环境探测
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
FORCE_FLAG=""

# ------------------------------------------------------------------
# 2. 帮助信息
# ------------------------------------------------------------------
show_help() {
    echo -e "${BOLD}SrP-Dotfiles 一键管理脚本${RESET}

${BOLD}用法:${RESET}
  $0 [子命令] [操作系统] [选项]

${BOLD}子命令:${RESET}
  all                  安装依赖并部署配置（默认）
  install              仅通过系统包管理器安装依赖
  config               仅部署 Dotfiles 软链接配置
  help, -h, --help     显示本帮助信息

${BOLD}支持的操作系统参数:${RESET}
  arch                 Arch Linux / Manjaro / WSL Arch
  debian               Debian / Ubuntu / 服务器环境
  termux               Android Termux 环境

${BOLD}选项:${RESET}
  -f, --force          部署配置时强制覆盖现有文件
  --os <type>          显式指定操作系统

${BOLD}示例:${RESET}
  $0                   # 启动交互式菜单
  $0 all               # 自动探测系统并完成全部安装与配置
  $0 install arch      # 为 Arch 系统安装依赖
  $0 config -f         # 强制覆盖部署当前环境的配置文件"
}

# ------------------------------------------------------------------
# 3. CLI 参数解析
# ------------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        all|install|config)
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
            FORCE_FLAG="-f"
            shift
            ;;
        -h|--help|help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}[ERROR]${RESET} 未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

# ------------------------------------------------------------------
# 4. 执行具体动作
# ------------------------------------------------------------------
run_install() {
    echo -e "${BLUE}==>${RESET} ${BOLD}执行依赖安装 ($TARGET_OS)...${RESET}"
    "$DOTFILES_DIR/install.sh" "$TARGET_OS"
}

run_config() {
    echo -e "${BLUE}==>${RESET} ${BOLD}执行配置部署 ($TARGET_OS)...${RESET}"
    if [ -n "$FORCE_FLAG" ]; then
        "$DOTFILES_DIR/config.sh" "$TARGET_OS" "$FORCE_FLAG"
    else
        "$DOTFILES_DIR/config.sh" "$TARGET_OS"
    fi
}

# 如果命令行传入了明确的操作指令，则直接非交互式执行
if [ -n "$ACTION" ]; then
    case "$ACTION" in
        all)
            run_install
            echo ""
            run_config
            ;;
        install)
            run_install
            ;;
        config)
            run_config
            ;;
    esac
    exit 0
fi

# ------------------------------------------------------------------
# 5. 交互式启动菜单 (无参数直接运行时)
# ------------------------------------------------------------------
echo -e "${CYAN}====================================================${RESET}"
echo -e "${BOLD}       🚀 欢迎使用 SrP-Dotfiles 一键配置管理器      ${RESET}"
echo -e "${CYAN}====================================================${RESET}"
echo -e " 📍 检测到操作系统: ${GREEN}${BOLD}${TARGET_OS}${RESET}"
echo -e " 💻 硬件架构:       ${YELLOW}${ARCH}${RESET}"
if [ "$IS_WSL" = "yes" ]; then
    echo -e " 🪟 WSL 环境:       ${GREEN}是 (WSL)${RESET}"
fi
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
        ;;
    2)
        run_install
        ;;
    3)
        read -rp " 是否开启强制覆盖模式 (-f)? [y/N]: " force_choice
        if [[ "$force_choice" =~ ^[Yy]$ ]]; then
            FORCE_FLAG="-f"
        fi
        run_config
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
            *) echo -e "${RED}无效选择，保持当前: $TARGET_OS${RESET}" ;;
        esac
        echo -e "已切换为: ${GREEN}${TARGET_OS}${RESET}"
        echo ""
        "$0"
        ;;
    0)
        echo "已取消。"
        exit 0
        ;;
    *)
        echo -e "${RED}无效选项，退出。${RESET}"
        exit 1
        ;;
esac
