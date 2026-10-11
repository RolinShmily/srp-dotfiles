#!/usr/bin/env bash
# scripts/lib/i18n.sh — Unix runtime messages for the deployment entrypoint.

I18N_LANG="${DF_LANG:-en}"

set_i18n_language() {
    case "${1:-en}" in
        zh|cn) I18N_LANG="zh" ;;
        en|英文) I18N_LANG="en" ;;
        *)
            printf '[WARN] Unsupported language: %s; using en.\n' "${1:-}" >&2
            I18N_LANG="en"
            ;;
    esac
    export DF_LANG="$I18N_LANG"
}

# Usage: i18n "key" [printf arguments...]
i18n() {
    local key="$1"
    shift

    if [ "$I18N_LANG" = "en" ]; then
        case "$key" in
            abort.double_ctrl_c) printf '\n[ABORT] Ctrl+C was pressed twice; the installation/deployment has been terminated.\n' ;;
            interrupt.skip) printf '\n[SKIP] Interrupted step: %s (press Ctrl+C again within 1 second to exit)\n' "$@" ;;
            step.running) printf 'Running: %s ...\n' "$@" ;;
            step.failed) printf 'Step [%s] failed (exit code: %s)!\n' "$@" ;;
            step.noninteractive) printf 'Non-interactive terminal detected; skipped this step.\n' ;;
            prompt.failure) printf 'An error occurred. Choose what to do next:\n' ;;
            prompt.skip) printf '  [s] Skip and continue [recommended/default]\n' ;;
            prompt.retry) printf '  [r] Retry this step\n' ;;
            prompt.abort) printf '  [a] Abort and exit\n' ;;
            prompt.choice) printf 'Choose [s/r/a, default s]: ' ;;
            step.manual_skip) printf 'Manually skipped step: %s\n' "$@" ;;
            step.retrying) printf 'Retrying step: %s ...\n' "$@" ;;
            step.user_abort) printf 'The user terminated the installation/deployment.\n' ;;
            step.invalid_default_skip) printf 'Unrecognized input; skipping by default.\n' ;;
            report.title) printf '              SrP-Dotfiles Installation & Deployment Report               \n' ;;
            report.os) printf ' Target OS: %s | Architecture: %s\n' "$@" ;;
            report.wsl_yes) printf ' WSL host environment: yes (WSL)\n' ;;
            report.time) printf ' Generated at: %s\n' "$@" ;;
            report.success) printf '✔ Completed successfully (%s):\n' "$@" ;;
            report.no_success) printf 'ℹ No items completed successfully.\n' ;;
            report.skipped) printf '⚠ Skipped/ignored items (%s):\n' "$@" ;;
            report.failed) printf '✖ Failed/aborted items (%s):\n' "$@" ;;
            report.hint) printf '💡 Hint: after resolving the issue, retry the skipped steps:\n' ;;
            report.install) printf '   - Reinstall dependencies: %s\n' "$@" ;;
            report.config) printf '   - Redeploy configuration: %s\n' "$@" ;;
            report.complete) printf '🎉 All installation and deployment steps completed successfully!\n' ;;
            manifest.node_missing) printf 'Reading manifest.json requires Node.js, but node is not installed.\n' ;;
            manifest.bootstrap) printf 'Node.js is required to read the manifest; attempting to install it automatically for %s.\n' "$@" ;;
            manifest.bootstrap_failed) printf 'Automatic Node.js bootstrap failed. Install nodejs manually and retry.\n' ;;
            manifest.bootstrap_done) printf 'Node.js bootstrap completed.\n' ;;
            manifest.install_hint) printf '  Install Node.js first, then retry:\n' ;;
            manifest.arch_hint) printf '    Arch / WSL        sudo pacman -S --needed nodejs npm\n' ;;
            manifest.debian_hint) printf '    Debian / Ubuntu   sudo apt-get install -y nodejs\n' ;;
            manifest.termux_hint) printf '    Termux            pkg install -y nodejs\n' ;;
            manifest.note) printf '  Note: install and config must read the manifest first, so node is required.\n' ;;
            profile.noninteractive) printf 'Detected Debian/Ubuntu without a profile. Use --os debian-vps or --os debian-homeserver.\n' ;;
            profile.detected) printf 'Debian/Ubuntu detected. Choose a deployment profile:\n' ;;
            profile.homeserver) printf '  1) debian-homeserver  (full base services and Pi Web agent)\n' ;;
            profile.vps) printf '  2) debian-vps          (minimal shell and operations tools)\n' ;;
            profile.choice) printf 'Choose [1/2]: ' ;;
            profile.invalid) printf 'Invalid Debian profile: %s\n' "$@" ;;
            pkg.unknown_os) printf 'Unknown operating system: %s; skipping system package installation.\n' "$@" ;;
            npm.missing) printf 'npm not found; skipped: %s\n' "$@" ;;
            skill.missing) printf 'Neither skills nor npx was found; skipped skill: %s\n' "$@" ;;
            install.title) printf '       Installing Unix system dependencies (%s)       \n' "$@" ;;
            config.title) printf '       Deploying Unix configuration files (%s)       \n' "$@" ;;
            manifest.missing) printf 'Manifest file not found: %s\n' "$@" ;;
            manifest.declaration) printf 'Manifest: %s\n' "$@" ;;
            config.target) printf 'Target configuration profile: %s\n' "$@" ;;
            config.force) printf 'Force overwrite mode enabled (-f / --force).\n' ;;
            step.system_packages) printf 'Install system dependencies (%s - %s packages)' "$@" ;;
            step.default_shell) printf 'Configure zsh as the default shell' ;;
            step.ohmyzsh) printf 'Install Oh My Zsh base framework' ;;
            step.npm) printf 'Global npm package [%s]' "$@" ;;
            step.skills) printf 'Agent skill [%s]' "$@" ;;
            step.ohmyzsh_deploy) printf 'Deploy Oh My Zsh plugins and Spaceship theme' ;;
            step.termux_font) printf 'Deploy Termux Nerd Font (MesloLGS NF)' ;;
            dispatch.condition) printf '[%s] Condition not met; skipped (%s)\n' "$@" ;;
            dispatch.custom_missing) printf '[%s] Custom deployment script not found: %s\n' "$@" ;;
            dispatch.custom) printf '[%s] Custom deployment' "$@" ;;
            dispatch.source_missing) printf '[%s] Repository source not found; skipped: %s\n' "$@" ;;
            dispatch.target_missing) printf '[%s] No target/targets declared; skipped\n' "$@" ;;
            dispatch.link) printf '[%s] Link -> %s' "$@" ;;
            dispatch.copy_example) printf '[%s] Copy example config -> %s' "$@" ;;
            dispatch.copy) printf '[%s] Copy -> %s' "$@" ;;
            dispatch.method_unknown) printf '[%s] Unknown method: %s (expected link | copy | custom)\n' "$@" ;;
            deploy.force_delete) printf '[force] Removing existing target: %s\n' "$@" ;;
            deploy.backup) printf 'Backing up existing target: %s -> %s\n' "$@" ;;
            deploy.update_link) printf 'Updating existing symlink: %s\n' "$@" ;;
            deploy.exclude) printf 'Skipping due to exclude: %s\n' "$@" ;;
            deploy.source_missing) printf 'Source not found, skipped: %s\n' "$@" ;;
            deploy.link_correct) printf 'Symlink already points correctly: %s\n' "$@" ;;
            deploy.linked) printf 'Linked: %s -> %s\n' "$@" ;;
            deploy.ifmissing) printf 'Target exists; kept due to ifMissing: %s\n' "$@" ;;
            deploy.overwrite_file) printf 'Overwrote in place: %s\n' "$@" ;;
            deploy.overwrite) printf 'Overwrote: %s\n' "$@" ;;
            deploy.example_existing) printf 'Target exists; keeping original and copying template to: %s\n' "$@" ;;
            deploy.example_missing) printf 'Target does not exist; creating from template: %s\n' "$@" ;;
            pi.no_source) printf 'Pi source directory not found: %s\n' "$@" ;;
            pi.settings_new) printf 'settings.json does not exist; creating from template\n' ;;
            pi.settings_existing) printf 'Existing settings.json detected; keeping it and copying template to settings.json.example\n' ;;
            pi.packages_empty) printf 'Manifest piPackages is empty; keeping packages from the template\n' ;;
            pi.missing_node) printf 'node or injection script is missing; skipped package injection\n' ;;
            pi.settings_keep) printf 'Existing settings.json kept; skipped package injection\n' ;;
            pi.orphans) printf '[%s] Orphans found in target (will not be deleted): %s\n' "$@" ;;
            pi.extension_pruned) printf '[extensions] Removed because it is not allowlisted: %s\n' "$@" ;;
            pi.done) printf 'Pi configuration deployed (copy overwrite): %s\n' "$@" ;;
            help.title) printf 'SrP-Dotfiles Unix environment manager (launch.sh)\n' ;;
            help.usage) printf 'Usage:\n  %s [command] [OS/profile] [options]\n' "$@" ;;
            help.commands) printf 'Commands:\n  all                  Install dependencies and deploy configuration (recommended)\n  install              Install environment dependencies only\n  config               Deploy Dotfiles configuration only\n  launch               Open the interactive menu (default without arguments)\n  help, -h, --help     Show this help\n' ;;
            help.os) printf 'Supported OS/profile values:\n  arch                 Arch Linux / Manjaro / WSL Arch\n  debian-homeserver    Debian / Ubuntu HomeServer (with Pi Web agent)\n  debian-vps           Debian / Ubuntu VPS (minimal tools)\n  termux               Android Termux\n' ;;
            help.options) printf 'Options:\n  -f, --force          Force overwrite during config deployment\n  --lang <zh|en>        Interface language / 界面语言 (default: en / 默认: en)\n  --os <type>          Explicit OS/profile\n' ;;
            help.errors) printf 'When a step fails, choose [s]kip, [r]etry, or [a]bort. A summary is printed at the end.\n' ;;
            help.examples) printf 'Examples:\n  %s\n  %s all\n  %s install arch\n  %s config -f\n  %s all debian-vps --lang en\n' "$0" "$0" "$0" "$0" "$0" ;;
            menu.title) printf '       SrP-Dotfiles Unix environment manager       \n' ;;
            menu.detected_os) printf ' Detected OS: %s\n' "$@" ;;
            menu.arch) printf ' Architecture: %s\n' "$@" ;;
            menu.wsl) printf ' WSL environment: yes (WSL)\n' ;;
            menu.manifest) printf ' Manifest: %s\n' "$@" ;;
            menu.choose) printf 'Choose an action:\n' ;;
            menu.all) printf '  1) Run all (install dependencies + deploy configuration) [recommended/default]\n' ;;
            menu.install) printf '  2) Install system dependencies only\n' ;;
            menu.config) printf '  3) Deploy configuration only\n' ;;
            menu.switch) printf '  4) Switch/select OS profile (current: %s)\n' "$@" ;;
            menu.exit) printf '  0) Exit\n' ;;
            menu.choice) printf 'Choose [1/2/3/4/0, default 1]: ' ;;
            menu.force) printf 'Enable force overwrite mode (-f)? [y/N]: ' ;;
            menu.profiles) printf 'Available OS/profile values:\n' ;;
            menu.profile_arch) printf '  1) arch               (Arch Linux / WSL)\n' ;;
            menu.profile_homeserver) printf '  2) debian-homeserver  (Debian / Ubuntu HomeServer)\n' ;;
            menu.profile_vps) printf '  3) debian-vps         (Debian / Ubuntu VPS)\n' ;;
            menu.profile_termux) printf '  4) termux             (Android Termux)\n' ;;
            menu.profile_choice) printf 'Choose [1-4]: ' ;;
            menu.invalid_choice) printf 'Invalid choice: %s\n' "$@" ;;
            menu.switched) printf 'Switched OS/profile to: %s\n' "$@" ;;
            menu.safe_exit) printf 'Exited safely.\n' ;;
            cli.unknown) printf 'Unknown argument: %s\n' "$@" ;;
            *) printf '%s' "$key" "$@" ;;
        esac
    else
        case "$key" in
            abort.double_ctrl_c) printf '\n[ABORT] 连续检测到 Ctrl+C，已彻底终止安装部署流程！\n' ;;
            interrupt.skip) printf '\n[SKIP] 已手动中断当前步骤: %s (1秒内再次按下 Ctrl+C 将彻底退出脚本)\n' "$@" ;;
            step.running) printf '正在执行: %s ...\n' "$@" ;;
            step.failed) printf '步骤 [%s] 执行失败 (退出码: %s)！\n' "$@" ;;
            step.noninteractive) printf '检测到非交互终端，已自动跳过此步骤。\n' ;;
            prompt.failure) printf '遇到执行异常，请选择后续处理方式：\n' ;;
            prompt.skip) printf '  [s] 跳过此步并继续 (Skip) [推荐/默认]\n' ;;
            prompt.retry) printf '  [r] 重试此步骤 (Retry)\n' ;;
            prompt.abort) printf '  [a] 终止并退出 (Abort)\n' ;;
            prompt.choice) printf '请选择 [s/r/a, 默认 s]: ' ;;
            step.manual_skip) printf '已手动跳过步骤: %s\n' "$@" ;;
            step.retrying) printf '正在重试步骤: %s ...\n' "$@" ;;
            step.user_abort) printf '用户主动终止安装部署流程。\n' ;;
            step.invalid_default_skip) printf '输入无法识别，默认跳过此步骤。\n' ;;
            report.title) printf '              📊 SrP-Dotfiles 安装与部署审计报告               \n' ;;
            report.os) printf ' 🎯 目标操作系统: %s | 硬件架构: %s\n' "$@" ;;
            report.wsl_yes) printf ' 💻 WSL 宿主环境: 是 (WSL)\n' ;;
            report.time) printf ' ⏱️ 报告生成时间: %s\n' "$@" ;;
            report.success) printf '✔ 成功完成 (%s 项):\n' "$@" ;;
            report.no_success) printf 'ℹ 没有成功完成的项目。\n' ;;
            report.skipped) printf '⚠ 跳过/忽略项目 (%s 项):\n' "$@" ;;
            report.failed) printf '✖ 失败/中止项目 (%s 项):\n' "$@" ;;
            report.hint) printf '💡 提示: 针对跳过或未完成的项目，您可以在排查网络/依赖后单独重试：\n' ;;
            report.install) printf '   - 重新安装依赖: %s\n' "$@" ;;
            report.config) printf '   - 重新部署配置: %s\n' "$@" ;;
            report.complete) printf '🎉 恭喜！所有安装与部署项目均完美就绪！\n' ;;
            manifest.node_missing) printf '读取 manifest.json 需要 node，但当前系统没有 node。\n' ;;
            manifest.bootstrap) printf '读取 manifest 前需要 Node.js，正在尝试为 %s 自动安装。\n' "$@" ;;
            manifest.bootstrap_failed) printf 'Node.js 自动安装失败，请手动安装 nodejs 后重试。\n' ;;
            manifest.bootstrap_done) printf 'Node.js 自动安装完成。\n' ;;
            manifest.install_hint) printf '  请先手动安装 node，然后重试：\n' ;;
            manifest.arch_hint) printf '    Arch / WSL        sudo pacman -S --needed nodejs npm\n' ;;
            manifest.debian_hint) printf '    Debian / Ubuntu   sudo apt-get install -y nodejs\n' ;;
            manifest.termux_hint) printf '    Termux            pkg install -y nodejs\n' ;;
            manifest.note) printf '  注：install 与 config 均需先读清单，所以 node 是任何子命令的前置。\n' ;;
            profile.noninteractive) printf '检测到 Debian/Ubuntu，但未指定部署 profile。请使用 --os debian-vps 或 --os debian-homeserver。\n' ;;
            profile.detected) printf '检测到 Debian/Ubuntu，请选择部署 profile：\n' ;;
            profile.homeserver) printf '  1) debian-homeserver  (完整基础服务与 Pi Web 智能体)\n' ;;
            profile.vps) printf '  2) debian-vps          (精简 Shell 与基础运维工具)\n' ;;
            profile.choice) printf '请选择 [1/2]: ' ;;
            profile.invalid) printf '无效的 Debian profile: %s\n' "$@" ;;
            pkg.unknown_os) printf '未知的操作系统类型: %s，跳过系统包安装。\n' "$@" ;;
            npm.missing) printf '未检测到 npm，跳过: %s\n' "$@" ;;
            skill.missing) printf '未检测到 skills 或 npx 命令，跳过技能安装: %s\n' "$@" ;;
            install.title) printf '       📦 执行 Unix 系统依赖安装 (%s)       \n' "$@" ;;
            config.title) printf '       ⚙️ 执行 Unix 配置文件部署 (%s)       \n' "$@" ;;
            manifest.missing) printf '未找到清单文件: %s\n' "$@" ;;
            manifest.declaration) printf '声明清单: %s\n' "$@" ;;
            config.target) printf '目标配置环境: %s\n' "$@" ;;
            config.force) printf '已开启强制覆盖模式 (-f / --force)。\n' ;;
            step.system_packages) printf '安装系统基础依赖 (%s - %s 个包)' "$@" ;;
            step.default_shell) printf '配置默认 Shell 为 zsh' ;;
            step.ohmyzsh) printf '安装 Oh My Zsh 基础框架' ;;
            step.npm) printf '全局 npm 依赖 [%s]' "$@" ;;
            step.skills) printf 'Agent 技能 [%s]' "$@" ;;
            step.ohmyzsh_deploy) printf '部署 Oh My Zsh 插件与 Spaceship 主题' ;;
            step.termux_font) printf '部署 Termux Nerd Font (MesloLGS NF) 字体' ;;
            dispatch.condition) printf '[%s] 条件未满足，跳过 (%s)\n' "$@" ;;
            dispatch.custom_missing) printf '[%s] 找不到自定义部署脚本: %s\n' "$@" ;;
            dispatch.custom) printf '[%s] 自定义部署' "$@" ;;
            dispatch.source_missing) printf '[%s] 仓库内源不存在，跳过: %s\n' "$@" ;;
            dispatch.target_missing) printf '[%s] 未声明 target/targets，跳过\n' "$@" ;;
            dispatch.link) printf '[%s] 链接 -> %s' "$@" ;;
            dispatch.copy_example) printf '[%s] 复制示例配置 -> %s' "$@" ;;
            dispatch.copy) printf '[%s] 复制 -> %s' "$@" ;;
            dispatch.method_unknown) printf '[%s] 未知 method: %s（应为 link | copy | custom）\n' "$@" ;;
            deploy.force_delete) printf '[强制模式] 删除现有目标: %s\n' "$@" ;;
            deploy.backup) printf '备份现有目标: %s -> %s\n' "$@" ;;
            deploy.update_link) printf '更新已有软链接: %s\n' "$@" ;;
            deploy.exclude) printf '按 exclude 跳过: %s\n' "$@" ;;
            deploy.source_missing) printf '源不存在，跳过: %s\n' "$@" ;;
            deploy.link_correct) printf '软链接已正确指向: %s\n' "$@" ;;
            deploy.linked) printf '已链接: %s -> %s\n' "$@" ;;
            deploy.ifmissing) printf '目标已存在，按 ifMissing 保留不动: %s\n' "$@" ;;
            deploy.overwrite_file) printf '已原地覆盖: %s\n' "$@" ;;
            deploy.overwrite) printf '已覆盖复制: %s\n' "$@" ;;
            deploy.example_existing) printf '目标已存在，保留原文件并将模板复制为: %s\n' "$@" ;;
            deploy.example_missing) printf '目标不存在，使用模板创建: %s\n' "$@" ;;
            pi.no_source) printf '仓库中不存在 pi 目录: %s\n' "$@" ;;
            pi.settings_new) printf 'settings.json 不存在，使用模板创建\n' ;;
            pi.settings_existing) printf '检测到已有 settings.json，保留原文件；模板将保存为 settings.json.example\n' ;;
            pi.packages_empty) printf 'manifest 的 piPackages 为空，settings.json 的 packages 保持模板值\n' ;;
            pi.missing_node) printf '缺少 node 或脚本，跳过 packages 注入\n' ;;
            pi.settings_keep) printf '已有 settings.json 保持不动，跳过 packages 注入\n' ;;
            pi.orphans) printf '[%s] 目标里存在仓库中已不存在的项（不会自动删除）: %s\n' "$@" ;;
            pi.extension_pruned) printf '[extensions] 不在白名单，已清理: %s\n' "$@" ;;
            pi.done) printf 'Pi 配置部署完成 (copy 覆盖): %s\n' "$@" ;;
            help.title) printf 'SrP-Dotfiles Unix 统一环境管理引擎 (launch.sh)\n' ;;
            help.usage) printf '用法:\n  %s [子命令] [操作系统/profile] [选项]\n' "$@" ;;
            help.commands) printf '子命令:\n  all                  安装依赖并部署配置 (默认推荐流水线)\n  install              仅安装环境依赖\n  config               仅部署 Dotfiles 配置\n  launch               启动交互式菜单 (无参数时的默认行为)\n  help, -h, --help     显示帮助信息\n' ;;
            help.os) printf '支持的操作系统/profile:\n  arch                 Arch Linux / Manjaro / WSL Arch\n  debian-homeserver    Debian / Ubuntu HomeServer（含 Pi Web 智能体）\n  debian-vps           Debian / Ubuntu VPS（精简基础工具）\n  termux               Android Termux 环境\n' ;;
            help.options) printf '选项:\n  -f, --force          部署配置时强制覆盖现有文件\n  --lang <zh|en>        Interface language / 界面语言 (default: en / 默认: en)\n  --os <type>          显式指定操作系统/profile\n' ;;
            help.errors) printf '当步骤失败时，可选择 [s]跳过、[r]重试或 [a]终止；结束时会生成汇总报告。\n' ;;
            help.examples) printf '示例:\n  %s\n  %s all\n  %s install arch\n  %s config -f\n  %s all debian-vps --lang en\n' "$0" "$0" "$0" "$0" "$0" ;;
            menu.title) printf '       🚀 欢迎使用 SrP-Dotfiles Unix 一键管理器       \n' ;;
            menu.detected_os) printf ' 🖥️ 检测到操作系统: %s\n' "$@" ;;
            menu.arch) printf ' ⚙️ 硬件架构: %s\n' "$@" ;;
            menu.wsl) printf ' 💻 WSL 环境: 是 (WSL)\n' ;;
            menu.manifest) printf ' 📄 规则清单文件: %s\n' "$@" ;;
            menu.choose) printf '请选择要执行的操作：\n' ;;
            menu.all) printf '  1) 全部执行 (安装系统依赖 + 部署配置文件) [推荐/默认]\n' ;;
            menu.install) printf '  2) 仅安装系统依赖 (Install Packages)\n' ;;
            menu.config) printf '  3) 仅部署配置文件 (Deploy Configs)\n' ;;
            menu.switch) printf '  4) 切换/指定操作系统 (当前: %s)\n' "$@" ;;
            menu.exit) printf '  0) 退出\n' ;;
            menu.choice) printf '请输入选项 [1/2/3/4/0, 默认 1]: ' ;;
            menu.force) printf '是否开启强制覆盖模式 (-f)? [y/N]: ' ;;
            menu.profiles) printf '可选操作系统/profile 列表:\n' ;;
            menu.profile_arch) printf '  1) arch               (Arch Linux / WSL)\n' ;;
            menu.profile_homeserver) printf '  2) debian-homeserver  (Debian / Ubuntu HomeServer)\n' ;;
            menu.profile_vps) printf '  3) debian-vps         (Debian / Ubuntu VPS)\n' ;;
            menu.profile_termux) printf '  4) termux             (Android Termux)\n' ;;
            menu.profile_choice) printf '请选择编号 [1-4]: ' ;;
            menu.invalid_choice) printf '无效的选择: %s\n' "$@" ;;
            menu.switched) printf '已切换操作系统为: %s\n' "$@" ;;
            menu.safe_exit) printf '已安全退出。\n' ;;
            cli.unknown) printf '未知参数: %s\n' "$@" ;;
            *) printf '%s' "$key" "$@" ;;
        esac
    fi
}
