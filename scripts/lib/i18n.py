"""Minimal bilingual messages for the installer (en / zh)."""

from __future__ import annotations

LANG = "en"

ZH = {
    "help.title": "SrP-Dotfiles 安装 / 部署入口",
    "help.usage": "用法: ./install.sh [-a|--all] [-i|--install] [-c|--config] [选项]（Windows 用 .\\install.ps1）",
    "help.commands": (
        "  -a, --all       安装依赖 + 部署配置\n"
        "  -i, --install   只安装依赖\n"
        "  -c, --config    只部署配置\n"
        "  （不带操作）     交互菜单\n"
        "  -h, --help      显示帮助"
    ),
    "help.options": (
        "  -y, --yes          全部自动确认（非交互环境必须显式指定）\n"
        "  -f, --force        配置覆盖时不备份\n"
        "      --apps <ids>      逗号分隔的应用 ID（pkg:/winget:/scoop:/font:/npm:/skill:）\n"
        "      --configs <names>  逗号分隔的配置项名称\n"
        "      --mirror-profile <name> 选择镜像预设（默认取 mirror.json 的 profile）\n"
        "      --mirror-<name> <value> 覆盖单项镜像 (github/npm/pypi/go/scoop)，none 清空\n"
        "      --proxy <url>       所有下载的代理；none 清空\n"
        "      --catalog         输出完整 catalog JSON 后退出\n"
        "      --os <name>       指定目标: arch|debian|fedora|termux|windows\n"
        "      --lang <zh|en> 界面语言（默认 en）\n"
        "      --dry-run      只打印将执行的命令，不改动系统"
    ),
    "help.examples": (
        "  ./install.sh                 # 交互菜单\n"
        "  ./install.sh -a -y           # 全自动\n"
        "  ./install.sh -c --os arch -f"
    ),
    "menu.title": "SrP-Dotfiles 环境管理器",
    "menu.target": " 目标: {0} | 仓库: {1}",
    "menu.choose": "请选择操作:",
    "menu.all": "  1) 安装依赖 + 部署配置 [默认]",
    "menu.install": "  2) 只安装依赖",
    "menu.config": "  3) 只部署配置",
    "menu.language": "  4) 切换语言 (当前: {0})",
    "menu.exit": "  0) 退出",
    "menu.choice": "选择 [1/2/3/4/0, 默认 1]: ",
    "menu.invalid": "无效选择: {0}",
    "menu.done": "已退出。",
    "prompt.confirm": "是否执行 [{0}] ({1})？[Y/n]: ",
    "prompt.failure": "步骤失败，选择后续操作:",
    "prompt.skip": "  [s] 跳过并继续 [默认]",
    "prompt.retry": "  [r] 重试本步骤",
    "prompt.abort": "  [a] 终止全部",
    "prompt.choice": "选择 [s/r/a, 默认 s]: ",
    "label.core": "核心",
    "label.optional": "可选",
    "step.running": "执行: {0} ...",
    "step.failed": "步骤 [{0}] 失败: {1}",
    "step.interrupted": "已跳过被中断的步骤: {0}",
    "step.skipped": "已跳过: {0}",
    "step.aborted": "用户终止了安装/部署流程。",
    "step.retrying": "重试: {0} ...",
    "step.cancelled": "已取消: {0}",
    "step.system_packages": "系统软件包 ({0}, {1} 个)",
    "step.copr": "启用软件源 [{0}]",
    "step.shell": "设置默认 Shell",
    "step.omz": "安装 Oh My Zsh",
    "step.omz_plugins": "部署 Oh My Zsh 插件与主题",
    "step.font": "安装字体 [{0}]",
    "step.npm": "npm 全局包 [{0}]",
    "step.skill": "Agent 技能 [{0}]",
    "step.policy": "配置 PowerShell 执行策略",
    "step.winget": "winget 软件包 [{0}]",
    "step.scoop_setup": "安装 Scoop 并刷新 PATH",
    "step.buckets": "配置 Scoop Buckets",
    "step.aria2": "配置 Aria2 多线程下载",
    "step.scoop_pkg": "Scoop 软件包 [{0}]",
    "step.uv": "安装 uv",
    "step.uv_python": "安装 Python 运行时 (uv)",
    "step.env": "配置 Windows 用户级环境变量",
    "step.git": "配置 git core.autocrlf",
    "step.pypi_mirror": "配置 PyPI 镜像（pip / uv）",
    "step.go_mirror": "配置 Go GOPROXY",
    "pypi.done": "PyPI 镜像已写入 {0}",
    "go.done": "GOPROXY 已写入 go env",
    "go.missing": "未检测到 go，仅本次运行导出 GOPROXY",
    "step.link": "[{0}] 链接 -> {1}",
    "step.copy": "[{0}] 复制 -> {1}",
    "step.copy_example": "[{0}] 模板 -> {1}",
    "report.title": "安装与部署报告",
    "report.os": "目标: {0} | 架构: {1}",
    "report.success": "[ok] 完成 ({0})",
    "report.skipped": "[skip] 跳过 ({0})",
    "report.failed": "[fail] 失败 ({0})",
    "report.complete": "全部步骤完成",
    "report.hint": "处理后可只重跑相关部分: ./install.sh -i | ./install.sh -c",
    "install.title": "安装依赖 ({0})",
    "install.done": "依赖安装完成。",
    "config.title": "部署配置 ({0})",
    "config.backup": "备份目录: {0}",
    "config.done": "配置部署完成。",
    "pkg.unknown_os": "未知系统类型: {0}",
    "pkg.sudo_hint": "需要 sudo 权限，请确认当前用户可提权。",
    "manifest.missing": "清单不存在: {0}",
    "manifest.invalid": "清单格式无效: {0} ({1})",
    "mirror.status": "网络镜像 [{0}]: GitHub={1} | npm={2} | proxy={3}",
    "mirror.profile_missing": "镜像 profile 不存在: {0}",
    "selection.unknown": "未知选择项: {0}",
    "selection.available": "可用项: {0}",
    "deploy.linked": "已链接: {0} -> {1}",
    "deploy.copied": "已复制: {0}",
    "deploy.overwrite": "已覆盖: {0}",
    "deploy.overwrite_file": "已原地覆盖: {0}",
    "deploy.backup": "旧文件已备份: {0} -> {1}",
    "deploy.force_delete": "强制覆盖，已删除: {0}",
    "deploy.source_missing": "源不存在，跳过 [{0}]: {1}",
    "deploy.if_missing": "目标已存在，跳过: {0}",
    "deploy.exclude": "跳过排除项: {0}",
    "deploy.example_existing": "目标已存在，模板写入: {0}",
    "deploy.example_missing": "目标不存在，按模板创建: {0}",
    "deploy.link_correct": "链接已正确: {0}",
    "deploy.link_fallback": "已创建链接（回退方案）: {0} -> {1}",
    "deploy.copy_fallback": "链接失败，已退化为复制: {0}",
    "shell.done": "默认 Shell 已设置为 zsh。",
    "shell.missing": "未找到 zsh，跳过 Shell 配置。",
    "omz.already": "Oh My Zsh 已安装，跳过。",
    "omz.done": "Oh My Zsh 安装完成。",
    "omz.plugins": "Oh My Zsh 插件与主题。",
    "font.downloading": "下载字体 [{0}] ...",
    "font.installed": "字体 [{0}] 已安装到 {1}。",
    "font.already": "字体 [{0}] 已存在: {1}",
    "font.failed": "字体 [{0}] 下载或安装失败。",
    "font.hint": "提示: 在 manifest/mirror.json 配置 githubProxy 或 proxy 后重试。",
    "font.unknown": "未知字体: {0}",
    "font.termux_unsupported": "Termux 只支持单个终端字体，跳过: {0}",
    "npm.missing": "未检测到 npm，跳过: {0}",
    "npm.done": "npm 全局包已安装: {0}",
    "npm.registry": "npm registry: {0}",
    "skill.missing": "未找到 skills / npx，跳过技能: {0}",
    "skill.done": "技能已安装: {0}",
    "copr.running": "启用 Copr 源: {0}",
    "winget.missing": "未检测到 winget，跳过 winget 软件包。",
    "scoop.setup": "Scoop 安装与环境就绪。",
    "scoop.buckets_empty": "mirror.json 未声明 scoopBuckets，跳过 Bucket 配置。",
    "scoop.package": "Scoop 软件包: {0}",
    "scoop.aria2": "Aria2 多线程下载配置。",
    "uv.install": "安装 uv。",
    "uv.missing": "uv 安装后仍不可用。",
    "uv.python": "通过 uv 安装 Python 运行时。",
    "git.done": "git core.autocrlf 已设置。",
    "git.missing": "未找到 git，跳过 git 配置。",
    "wt.created": "已按模板创建 Windows Terminal 配置: {0}",
    "wt.merged": "已合并 Windows Terminal 配置（保留 defaultProfile / profiles.list）。",
    "wt.template_missing": "Windows Terminal 模板不存在: {0}",
    "pi.done": "Pi 配置已部署: {0}",
    "pi.missing": "Pi 配置源不存在: {0}",
    "config.invalid": "忽略无效配置项（缺少 name/method）。",
    "config.condition": "[{0}] 条件不满足，跳过 ({1})",
    "config.custom_missing": "[{0}] 自定义部署脚本不存在: {1}",
    "config.method_unknown": "[{0}] 未知 method: {1}",
    "config.source_missing": "[{0}] 源不存在，跳过: {1}",
    "config.target_missing": "[{0}] 未声明 target/targets，跳过。",
    "config.custom": "[{0}] 自定义部署",
    "env.shell": "Windows 用户级 SHELL 环境变量。",
    "error.no_tty": "标准输入不是终端；请显式加 -y / --yes 以自动确认。",
    "error.python": "需要 Python 3.9+，当前版本过低。",
}

EN = {
    "help.title": "SrP-Dotfiles installer / deployer",
    "help.usage": "Usage: ./install.sh [-a|--all] [-i|--install] [-c|--config] [options] (Windows: .\\install.ps1)",
    "help.commands": (
        "  -a, --all       install dependencies + deploy configs\n"
        "  -i, --install   install dependencies only\n"
        "  -c, --config    deploy configs only\n"
        "  (no action)     interactive menu\n"
        "  -h, --help      show this help"
    ),
    "help.options": (
        "  -y, --yes          approve every step (required when stdin is not a TTY)\n"
        "  -f, --force        overwrite configs without backup\n"
        "      --apps <ids>   comma separated app IDs (pkg:/winget:/scoop:/font:/npm:/skill:)\n"
        "      --configs <names>  comma separated config names\n"
        "      --mirror-profile <name> select a mirror profile (default: mirror.json profile)\n"
        "      --mirror-<name> <value> override one mirror (github/npm/pypi/go/scoop); none clears\n"
        "      --proxy <url>      proxy for all downloads; none clears\n"
        "      --catalog      print the full catalog JSON and exit\n"
        "      --os <name>    target: arch|debian|fedora|termux|windows\n"
        "      --lang <zh|en> UI language (default: en)\n"
        "      --dry-run      print commands without changing the system"
    ),
    "help.examples": (
        "  ./install.sh                 # interactive menu\n"
        "  ./install.sh -a -y           # fully automated\n"
        "  ./install.sh -c --os arch -f"
    ),
    "menu.title": "SrP-Dotfiles environment manager",
    "menu.target": " Target: {0} | repo: {1}",
    "menu.choose": "Choose an action:",
    "menu.all": "  1) Install + deploy [default]",
    "menu.install": "  2) Install dependencies only",
    "menu.config": "  3) Deploy configs only",
    "menu.language": "  4) Change language (current: {0})",
    "menu.exit": "  0) Exit",
    "menu.choice": "Choose [1/2/3/4/0, default 1]: ",
    "menu.invalid": "Invalid choice: {0}",
    "menu.done": "Exited.",
    "prompt.confirm": "Run [{0}] ({1})? [Y/n]: ",
    "prompt.failure": "Step failed. Choose what to do:",
    "prompt.skip": "  [s] Skip and continue [default]",
    "prompt.retry": "  [r] Retry this step",
    "prompt.abort": "  [a] Abort everything",
    "prompt.choice": "Choose [s/r/a, default s]: ",
    "label.core": "core",
    "label.optional": "optional",
    "step.running": "Running: {0} ...",
    "step.failed": "Step [{0}] failed: {1}",
    "step.interrupted": "Skipped interrupted step: {0}",
    "step.skipped": "Skipped: {0}",
    "step.aborted": "Installation/deployment aborted by user.",
    "step.retrying": "Retrying: {0} ...",
    "step.cancelled": "Cancelled: {0}",
    "step.system_packages": "System packages ({0}, {1} items)",
    "step.copr": "Enable repository [{0}]",
    "step.shell": "Set default shell",
    "step.omz": "Install Oh My Zsh",
    "step.omz_plugins": "Deploy Oh My Zsh plugins and theme",
    "step.font": "Install font [{0}]",
    "step.npm": "npm global package [{0}]",
    "step.skill": "Agent skill [{0}]",
    "step.policy": "Configure PowerShell execution policy",
    "step.winget": "winget package [{0}]",
    "step.scoop_setup": "Install Scoop and refresh PATH",
    "step.buckets": "Configure Scoop buckets",
    "step.aria2": "Configure Aria2 downloads",
    "step.scoop_pkg": "Scoop package [{0}]",
    "step.uv": "Install uv",
    "step.uv_python": "Install Python runtime (uv)",
    "step.env": "Configure Windows user environment",
    "step.git": "Configure git core.autocrlf",
    "step.pypi_mirror": "Configure PyPI mirror (pip / uv)",
    "step.go_mirror": "Configure Go GOPROXY",
    "pypi.done": "PyPI mirror written to {0}",
    "go.done": "GOPROXY written to go env",
    "go.missing": "go not found; GOPROXY is only exported for this run",
    "step.link": "[{0}] link -> {1}",
    "step.copy": "[{0}] copy -> {1}",
    "step.copy_example": "[{0}] template -> {1}",
    "report.title": "Installation & deployment report",
    "report.os": "Target: {0} | arch: {1}",
    "report.success": "[ok] Completed ({0})",
    "report.skipped": "[skip] Skipped ({0})",
    "report.failed": "[fail] Failed ({0})",
    "report.complete": "All steps completed",
    "report.hint": "Re-run only what is needed: ./install.sh -i | ./install.sh -c",
    "install.title": "Installing dependencies ({0})",
    "install.done": "Dependency installation finished.",
    "config.title": "Deploying configs ({0})",
    "config.backup": "Backup directory: {0}",
    "config.done": "Config deployment finished.",
    "pkg.unknown_os": "Unknown OS: {0}",
    "pkg.sudo_hint": "sudo is required; make sure the current user can elevate.",
    "manifest.missing": "Manifest not found: {0}",
    "manifest.invalid": "Invalid manifest: {0} ({1})",
    "mirror.status": "Mirrors [{0}]: GitHub={1} | npm={2} | proxy={3}",
    "mirror.profile_missing": "Mirror profile not found: {0}",
    "selection.unknown": "Unknown selection: {0}",
    "selection.available": "Available: {0}",
    "deploy.linked": "Linked: {0} -> {1}",
    "deploy.copied": "Copied: {0}",
    "deploy.overwrite": "Overwrote: {0}",
    "deploy.overwrite_file": "Overwrote in place: {0}",
    "deploy.backup": "Backed up: {0} -> {1}",
    "deploy.force_delete": "Force mode, removed: {0}",
    "deploy.source_missing": "Source missing, skipped [{0}]: {1}",
    "deploy.if_missing": "Target exists, skipped: {0}",
    "deploy.exclude": "Excluded item: {0}",
    "deploy.example_existing": "Target exists; template written to: {0}",
    "deploy.example_missing": "Target missing; created from template: {0}",
    "deploy.link_correct": "Link already correct: {0}",
    "deploy.link_fallback": "Linked via fallback: {0} -> {1}",
    "deploy.copy_fallback": "Link failed, fell back to copy: {0}",
    "shell.done": "Default shell set to zsh.",
    "shell.missing": "zsh not found; shell setup skipped.",
    "omz.already": "Oh My Zsh already installed; skipped.",
    "omz.done": "Oh My Zsh installed.",
    "omz.plugins": "Oh My Zsh plugins and theme.",
    "font.downloading": "Downloading font [{0}] ...",
    "font.installed": "Font [{0}] installed to {1}.",
    "font.already": "Font [{0}] already present: {1}",
    "font.failed": "Font [{0}] download or install failed.",
    "font.hint": "Hint: set githubProxy or proxy in manifest/mirror.json and retry.",
    "font.unknown": "Unknown font: {0}",
    "font.termux_unsupported": "Termux supports a single terminal font; skipped: {0}",
    "npm.missing": "npm not found; skipped: {0}",
    "npm.done": "npm global package installed: {0}",
    "npm.registry": "npm registry: {0}",
    "skill.missing": "Neither skills nor npx found; skipped skill: {0}",
    "skill.done": "Skill installed: {0}",
    "copr.running": "Enabling Copr repo: {0}",
    "winget.missing": "winget not found; skipping winget packages.",
    "scoop.setup": "Installing Scoop and preparing PATH.",
    "scoop.buckets_empty": "mirror.json declares no scoopBuckets; skipped bucket setup.",
    "scoop.package": "Scoop package: {0}",
    "scoop.aria2": "Configuring Aria2 downloads.",
    "uv.install": "Installing uv.",
    "uv.missing": "uv still unavailable after installation.",
    "uv.python": "Installing the Python runtime via uv.",
    "git.done": "git core.autocrlf configured.",
    "git.missing": "git not found; skipped git setup.",
    "wt.created": "Created Windows Terminal settings from the template: {0}",
    "wt.merged": "Merged Windows Terminal settings (kept defaultProfile / profiles.list).",
    "wt.template_missing": "Windows Terminal template missing: {0}",
    "pi.done": "Pi configuration deployed: {0}",
    "pi.missing": "Pi configuration source missing: {0}",
    "config.invalid": "Ignoring invalid config entry (missing name/method).",
    "config.condition": "[{0}] Condition not met; skipped ({1})",
    "config.custom_missing": "[{0}] Custom deploy module missing: {1}",
    "config.method_unknown": "[{0}] Unknown method: {1}",
    "config.source_missing": "[{0}] Source missing; skipped: {1}",
    "config.target_missing": "[{0}] No target/targets declared; skipped.",
    "config.custom": "[{0}] custom deployment",
    "env.shell": "Windows user-level SHELL environment.",
    "error.no_tty": "stdin is not a TTY; pass -y / --yes to approve steps automatically.",
    "error.python": "Python 3.9+ is required; current version is too old.",
}

MESSAGES = {"zh": ZH, "en": EN}


def set_language(value: str | None) -> str:
    global LANG
    value = (value or "en").lower()
    LANG = "zh" if value in ("zh", "cn") else "en"
    return LANG


def t(key: str, *args) -> str:
    template = MESSAGES[LANG].get(key) or MESSAGES["en"].get(key) or key
    if not args:
        return template
    return template.format(*args)
