# SrP-Dotfiles

> **A unified, modern, declarative, and cross-platform Dotfiles configuration ecosystem.**  
> **统一、现代且声明式驱动的跨平台 Dotfiles 统一配置与开发环境系统。**

<p align="left">
  <a href="#english"><b>English</b></a> •
  <a href="#chinese"><b>中文说明</b></a>
</p>

---

<a name="english"></a>

# 🌐 English

SrP-Dotfiles utilizes a **Single Branch (`main`) + Declarative Manifest (`manifest.toml`) + Twin Master Control Engines (`launch.sh` / `start.ps1`)** architecture. It provides first-class native support for both **Unix-like environments (Arch Linux, WSL 2, Debian/Ubuntu, Android Termux)** and **Windows host systems (Windows 10/11)**.

---

## ✨ Key Features

- 🎯 **Single Source of Truth (`manifest.toml`)**: Centralized declaration of system packages, domestic mirrors, global npm tools, and symlink targets across Arch, Debian, Termux, and Windows. Add or remove dependencies without modifying any shell scripts.
- 🛡️ **Resilient Pipeline & Execution Audit**:
  - **Fail-and-Ask Error Handling**: When network timeouts or command errors occur, choose `[s] Skip`, `[r] Retry`, or `[a] Abort` on the fly to prevent pipeline crashes.
  - **Two-Stage `Ctrl + C` Interrupt**: Single press `Ctrl + C` skips the current hanging step and continues the pipeline; press `Ctrl + C` twice within 1.2s to cleanly abort and immediately print the full audit summary.
  - **Audit Ledger**: Outputs a structured *Deployment Audit Report* after execution, detailing successful, skipped, and failed tasks with retry commands.
  - **Safe Backup Archiving**: Automatically backs up conflicting existing configurations with timestamps to `~/.dotfiles_backup/`.
- 🐧 **Modern Unix Suite (`launch.sh`)**:
  - **Modular Zsh (`zsh.d/`)**: Decoupled into environment variables, Oh My Zsh plugins, Spaceship theme, Git aliases, modern CLI replacements, and OS-specific scripts.
  - **Terminal Power Tools**: Integrated Zellij multiplexer, Yazi file manager, Btop system monitor, Fastfetch system info, and lightweight Vim configuration.
  - **WSL & Termux Enhancements**: Seamless Windows clipboard bridge in WSL; automatic Nerd Font injection in Android Termux.
- 🪟 **Industrial-Grade Windows Workflow (`start.ps1`)**:
  - **Tuned WezTerm Configuration**: Low-power 30 FPS rendering, crisp classic blinking block cursor, smart URL parsing & regex cleanup, keyboard-driven QuickSelect (`Alt+Ctrl+u`), and instant custom wallpaper toggle (`Alt+/`).
  - **PowerShell 7 Profile**: 100% aligned with Unix Git/GitHub CLI workflows (`ghci`, `pr`, `grbom`, `gfrb`, `gcam`, `gst`), directory sync for Yazi (`yz`), and quick navigation (`proj`, `dir`, `clone`, `grt`).
  - **Scoop Acceleration**: Automatic configuration of Nanjing University (NJU) mirrors and Aria2 multi-threaded download acceleration.
  - **Graceful Privilege Degradation**: Prioritizes native symbolic links; safely falls back to file copying if Developer Mode is disabled.
- 🤖 **Pi Coding Agent Deep Integration**: Global agent safety standards (`AGENTS.md`), custom extension suite (Image Generation, Streaming Voice ASR, Long-Term Memory, Multi-Pane Subagents, Vision, Web Extraction), and prompt/skill toolchains.

---

## 📂 Repository Topology

```text
srp-dotfiles/
├── manifest.toml          # 🧠 Central brain: declarative packages, buckets & symlinks
│
├── 🚀 Cross-Platform Twin Engines
│   ├── launch.sh          # Unix master engine (Interactive menu, install, symlink & audit)
│   └── start.ps1          # Windows master engine (Interactive menu, Winget/Scoop, symlink & audit)
│
├── 🐧 Unix Configuration Suite
│   ├── .zshrc             # Zsh entrypoint (symlinked to ~/.zshrc)
│   ├── .vimrc             # Lightweight Vim configuration (symlinked to ~/.vimrc)
│   ├── zsh.d/             # Modular Zsh scripts
│   │   ├── env.zsh        # Environment variables, NVM, PATH, Locale & Editor
│   │   ├── omz.zsh        # Oh My Zsh plugins & Spaceship theme
│   │   ├── git.zsh        # Git aliases, shortcuts & GPG/SSH commit signing
│   │   ├── aliases.zsh    # Modern CLI aliases (eza, bat, fd) & directory navigation
│   │   ├── tools.zsh      # Zellij, Yazi, Zoxide & FZF integrations
│   │   └── os/            # OS-specific adaptations (Arch/WSL, Debian, Termux)
│   ├── btop/              # Btop monitor (Catppuccin Mocha theme)
│   ├── fastfetch/         # Fastfetch system info configuration
│   ├── yazi/              # Yazi terminal file manager configuration & plugins
│   └── zellij/            # Zellij terminal multiplexer layouts & keybindings
│
├── 🪟 Windows Configuration Suite
│   ├── wezterm/           # WezTerm terminal configuration (.wezterm.lua) & background
│   └── powershell/        # Windows PowerShell 7 global profile template ($PROFILE)
│
└── 🤖 Pi Agent Architecture
    ├── pi/settings.json.example # Secure runtime configuration template
    ├── pi/AGENTS.md       # Global agent behavioral & safety rules
    ├── pi/extensions/     # Custom extensions (srp-image, srp-voice, srp-memory, etc.)
    ├── pi/skills/         # Custom agent skills
    ├── pi/prompts/        # Structured prompt templates
    └── scripts/merge_pi_settings.js # Safe settings.json merge tool
```

---

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

---

### 2. Unix Deployment (Linux / WSL / Termux)

Launch the interactive console menu:

```bash
./launch.sh
```

Or run non-interactively with CLI arguments:

```bash
# Auto-detect OS and run full pipeline (install + symlink deployment) [Recommended]
./launch.sh all

# Install dependencies only via system package managers (Pacman / Apt / Pkg / npm / skills)
./launch.sh install

# Deploy and synchronize Dotfiles symlinks only
./launch.sh config

# Force overwrite mode (skip conflict prompts)
./launch.sh config -f

# Explicitly specify target distribution
./launch.sh install arch
```

> **Apply changes**: Restart your terminal or run `source ~/.zshrc`.

---

### 3. Windows Deployment (PowerShell 7 / Windows Terminal)

In PowerShell 7, navigate to the cloned directory:

```powershell
# Launch interactive console menu [Recommended]
.\start.ps1
```

Or run directly with subcommands:

```powershell
# Full pipeline: install tools & deploy symlinks
.\start.ps1 all

# Install tools only (based on manifest.toml [windows])
.\start.ps1 install

# Deploy configuration symlinks only (WezTerm, PowerShell Profile, configs)
.\start.ps1 config

# Force overwrite mode
.\start.ps1 config -Force
```

---

## ⌨️ Productivity Shortcuts Cheat Sheet

### WezTerm (Windows)

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Alt + /`** | **Toggle Background Image** | Toggle between custom background image and pure black focus mode |
| **`Alt + f`** | **Terminal Search** | Full-screen interactive search across terminal scrollback |
| **`F2`** | **Command Palette** | Fuzzy-search all WezTerm commands and actions (VSCode style) |
| **`Alt + Ctrl + u`** | **QuickSelect URL** | Highlight URLs on screen; press assigned label to open in browser |
| **`Ctrl + Left Click`**| **Open Link** | Click any link to open; automatically trims surrounding brackets |
| **`F1`** | **Vi Copy Mode** | Navigate scrollback with keyboard and copy text |

### PowerShell 7 & Zsh Aligned Commands

| Command | Target Action | Description |
| :--- | :--- | :--- |
| `yz` | **Yazi CWD Sync** | Open Yazi file manager; synchronizes shell CWD upon exit |
| `proj [name]` | **Project Jump** | Jump to `~/Projects` or a specific project subfolder |
| `grt` | **Git Root** | Instantly return to the top-level directory of current Git repo |
| `clone <url>` | **Clone & Enter** | Clone a Git repository and automatically `cd` into its directory |
| `clonep <url>`| **Clone & VS Code**| Clone repo under `~/Projects` and open immediately in VS Code |
| `ghci` | **GitHub CI Status** | Run `gh run list -L 1` to check latest GitHub Actions workflow status |
| `pr [ls \| id]` | **GitHub PR Quick** | List pull requests (`pr ls`) or checkout PR (`pr <id>`) |
| `grbom` | **Git Rebase Main** | Auto-detect `origin/main` or `origin/master` and rebase |
| `gfrb` | **Fetch & Rebase** | Run `git fetch origin` and rebase on default remote branch |
| `gcam "msg"` | **Git Add & Commit**| Stage all changes and commit with message |
| `gcfg <name> <mail>` | **Git Config User** | Quickly configure global Git user name and email |

---

## 🛠️ Advanced Customization

### 1. Declarative Package Management (`manifest.toml`)
To install new packages on any platform, append the package identifier to `manifest.toml` without touching any script:

```toml
[windows]
winget_packages = [ "wez.wezterm", "Git.Git" ]
scoop_packages  = [ "sox", "neovim", "fzf" ]

[arch]
packages = [ "zsh", "eza", "ripgrep" ]
```

### 2. Intelligent Two-Stage `Ctrl + C` Interrupt
Both `./launch.sh` and `.\start.ps1` feature a built-in signal state machine:
- **Single `Ctrl + C`**: Gracefully interrupts and skips the currently hanging step (e.g. slow network download) and moves seamlessly to the next step.
- **Double `Ctrl + C` (within 1.2s)**: Completely aborts the execution pipeline and instantly prints the *Deployment Audit Report*.

### 3. Local Private Environment Isolation (`~/.zshrc.local`)
For machine-specific sensitive variables (API tokens, private proxies) that should never be committed to Git:

```bash
# ~/.zshrc.local
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```
`.zshrc` automatically sources this file silently upon startup.

---

## 🔤 Recommended Font

We recommend installing [Maple Mono NF CN](https://github.com/subframe7536/maple-font) (Maple Mono with Nerd Fonts icons and Chinese glyphs) for clean ligatures and terminal alignment.  
*(Note: Windows setup via `.\start.ps1 install` automatically installs this font via Scoop)*.

---

## 💖 Acknowledgements

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — Reference for WezTerm tuning, smooth URL cleanup, and QuickSelect design.
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) — Reference for Pi Coding Agent extension architecture.
- [BarryYangi/chezmoi-dotfiles](https://github.com/BarryYangi/chezmoi-dotfiles) — Reference for modular Zsh architecture and OS branching.

---
---

<a name="chinese"></a>

# 🇨🇳 中文说明

SrP-Dotfiles 采用 **单分支（`main`）+ 声明式清单（`manifest.toml`）+ 跨平台双子星总控引擎（`launch.sh` / `start.ps1`）** 架构，原生深度适配 **类 Unix 系统（Arch Linux / WSL 2 / Debian / Ubuntu / Android Termux）** 与 **Windows 宿主环境（Windows 10/11）**。

---

## ✨ 核心特性

- 🎯 **单一真实数据源 (`manifest.toml`)**：不同平台（Arch、Debian、Termux、Windows）的软件包、国内镜像加速源、npm 全局工具与部署目标集中声明，增删依赖零改动代码。
- 🛡️ **韧性流水线与执行审计报告**：
  - **遇错智能拦截 (Fail-and-Ask)**：网络波动或安装异常时，支持一键 `[s] 跳过`、`[r] 重试` 或 `[a] 终止`，杜绝单点报错导致流程崩溃；
  - **智能两级 `Ctrl + C` 中断**：单次按下 `Ctrl + C` 仅跳过当前卡住的子步骤并平滑继续下一步；1.2 秒内连按两次 `Ctrl + C` 彻底安全终止并立即打印全量审计报表；
  - **部署审计看板**：每次运行结束输出结构化的《安装与部署审计报告》，精准汇总成功、跳过与失败项并提供重试指引；
  - **安全备份机制**：覆盖前自动按时间戳归档旧配置至 `~/.dotfiles_backup/`。
- 🐧 **类 Unix 现代化套件 (`launch.sh`)**：
  - **模块化 Zsh (`zsh.d/`)**：拆分为环境变量、Oh My Zsh、Spaceship 主题、Git 别名、现代 CLI 增强与操作系统特供片段；
  - **终端利器集成**：Zellij 复用器、Yazi 文件管理器、Btop 性能监控、Fastfetch 系统看板与轻量 Vim；
  - **移动端/WSL 适配**：Android Termux 自动注入 Nerd Font，WSL 剪贴板无缝桥接。
- 🪟 **Windows 工业级工作流 (`start.ps1`)**：
  - **WezTerm 工业级调优**：低功耗 30 FPS 渲染、经典快闪烁方块光标、智能 URL 清洗与全键盘 QuickSelect (`Alt+Ctrl+u`)、专属背景图 / 纯黑底色一键秒切 (`Alt+/`)；
  - **PowerShell 7 + Oh My Posh**：全局 Profile 模板自动软链部署，100% 对齐 Unix Git/GitHub CLI 工作流（`ghci`, `pr`, `grbom`, `gfrb`, `gcam`, `gst`），集成 `yz`（Yazi 退出同步目录）、`proj`、`clone`、`grt` 等全套提效函数；
  - **国内镜像源与多线程加速**：Scoop 自动配置南京大学镜像源（main/extras/versions/nerd-fonts）与 Aria2 多线程下载加速；
  - **权限优雅降级**：优先建立符号链接（支持开发实时双向同步），无开发者模式时自动安全降级为文件复制。
- 🤖 **Pi Coding Agent 深度集成**：内置全局智能体规范（`AGENTS.md`）、自研扩展集（OpenRouter生图、流式语音识别、长期记忆、多Pane子智能体、视觉理解、网页抓取）、提示词与技能工具链。

---

## 📂 仓库目录拓扑

```text
srp-dotfiles/
├── manifest.toml          # 🧠 核心大脑：全平台依赖、镜像源与配置声明式清单
│
├── 🚀 跨平台统一引擎
│   ├── launch.sh          # Unix 总控引擎 (聚合交互菜单、依赖安装、软链部署与审计)
│   └── start.ps1          # Windows 总控引擎 (聚合交互菜单、Winget/Scoop安装、软链部署与审计)
│
├── 🐧 类 Unix 系统配置体系
│   ├── .zshrc             # Zsh 主入口 (软链至 ~/.zshrc)
│   ├── .vimrc             # 现代轻量 Vim 配置 (软链至 ~/.vimrc)
│   ├── zsh.d/             # 模块化 Zsh 配置片段
│   │   ├── env.zsh        # 环境变量、NVM、PATH、Locale 与默认编辑器
│   │   ├── omz.zsh        # Oh My Zsh 插件与 Spaceship 现代主题
│   │   ├── git.zsh        # Git 别名、快捷函数与 GPG/SSH 签名
│   │   ├── aliases.zsh    # 现代 CLI 工具别名 (eza, bat, fd) 与目录导航
│   │   ├── tools.zsh      # Zellij, Yazi, Zoxide, FZF 深度集成
│   │   └── os/            # 操作系统特供片段 (Arch/WSL、Debian、Termux 剪贴板与环境)
│   ├── btop/              # Btop 性能监控 (Catppuccin Mocha 主题)
│   ├── fastfetch/         # Fastfetch 系统信息美化展示
│   ├── yazi/              # Yazi 现代终端文件管理器配置与插件
│   └── zellij/            # Zellij 终端复用器布局与键位映射
│
├── 🪟 Windows 系统配置体系
│   ├── wezterm/           # WezTerm 现代终端工业级配置 (.wezterm.lua) 与专属背景图
│   └── powershell/        # Windows PowerShell 7 全局 Profile 模板 (整合 Oh-My-Posh)
│
└── 🤖 Pi Agent 智能体体系
    ├── pi/settings.json.example # 安全运行时配置模板
    ├── pi/AGENTS.md       # 全局智能体通用行为与安全准则
    ├── pi/extensions/     # 核心扩展体系 (srp-image, srp-voice, srp-memory 等)
    ├── pi/skills/         # 自定义技能工具库
    ├── pi/prompts/        # 结构化 Prompt 模板
    └── scripts/merge_pi_settings.js # settings.json 安全合并工具
```

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

---

### 2. 类 Unix 环境部署 (Linux / WSL / Termux)

运行主入口脚本启动交互式控制台菜单：

```bash
./launch.sh
```

或使用命令行参数执行非交互自动化流水线：

```bash
# 自动探测系统并全量完成安装与配置部署 (推荐)
./launch.sh all

# 仅通过系统包管理器安装环境依赖 (Pacman / Apt / Pkg / npm / skills)
./launch.sh install

# 仅部署与同步 Dotfiles 软链接配置
./launch.sh config

# 强制覆盖模式 (跳过旧配置冲突询问)
./launch.sh config -f

# 显式指定操作系统安装 (可选: arch | debian | termux)
./launch.sh install arch
```

> **配置生效**：部署完成后，重启终端或在终端执行 `source ~/.zshrc` 即可即时生效。

---

### 3. Windows 环境部署 (PowerShell 7 / Windows Terminal)

在 Windows PowerShell 终端中进入仓库根目录：

```powershell
# 启动交互式控制台菜单 (推荐)
.\start.ps1
```

或使用命令行参数直接执行：

```powershell
# 全量自动化流水线：环境依赖安装 + 符号链接部署
.\start.ps1 all

# 仅安装系统依赖与工具 (基于 manifest.toml [windows])
.\start.ps1 install

# 仅部署并同步配置文件 (WezTerm + PowerShell Profile 符号链接)
.\start.ps1 config

# 强制覆盖模式
.\start.ps1 config -Force
```

---

## ⌨️ 高频快捷键速查

### WezTerm (Windows)

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| **`Alt + /`** | **专属背景图 / 纯黑底色切换** | 默认开启专属背景图，一键秒切纯黑专注模式 |
| **`Alt + f`** | **终端全屏实时搜索** | 高亮检索屏幕与所有回滚历史输出 |
| **`F2`** | **唤起 Command Palette 命令面板** | 类似 VSCode 模糊搜索所有终端操作与设置 |
| **`Alt + Ctrl + u`** | **URL 免鼠标 QuickSelect** | 全屏高亮所有链接，按提示字母一键在浏览器打开 |
| **`Ctrl + 鼠标左键`** | **精准点击打开链接** | 正则自动剥离括号/尖括号，杜绝 404 |
| **`F1`** | **Vi 键盘复制模式 (Copy Mode)** | 纯键盘移动光标选中文本并复制 |

### PowerShell 7 与 Zsh 统一快捷指令

| 指令 | 对应操作 | 功能说明 |
| :--- | :--- | :--- |
| `yz` | **Yazi CWD 同步** | 启动 Yazi 文件管理器，退出时自动同步 Shell 当前工作目录 |
| `proj [name]` | **项目快速跳转** | 直达 `~/Projects` 或指定子项目目录 |
| `grt` | **Git 根目录** | 一秒回到当前 Git 仓库顶层根目录 |
| `clone <url>` | **克隆并进入** | 克隆 Git 仓库并自动 `cd` 进入该项目目录 |
| `clonep <url>`| **克隆并在 VSCode 打开** | 在 `~/Projects` 下克隆并立即用 VS Code 打开 |
| `ghci` | **GitHub CI 状态** | 执行 `gh run list -L 1` 秒查最近一次 Actions 状态 |
| `pr [ls \| id]` | **GitHub PR 操作** | 列出 PR 列表 (`pr ls`) 或检出 PR 到本地 (`pr <id>`) |
| `grbom` | **Git Rebase 主分支** | 自动探测 `origin/main` 或 `origin/master` 并执行变基 |
| `gfrb` | **Fetch 并 Rebase** | 执行 `git fetch origin` 并自动变基至远端主分支 |
| `gcam "msg"` | **一键暂存并提交** | 相当于 `git add -A && git commit -m "msg"` |
| `gcfg <name> <mail>` | **配置 Git 身份** | 极速设置全局 Git 用户名与邮箱 |

---

## 🛠️ 进阶定制与扩展

### 1. 声明式扩展新软件 (`manifest.toml`)
无论在哪个平台需要新增软件包，仅需在 `manifest.toml` 对应节中追加名称，无需改动脚本：

```toml
[windows]
winget_packages = [ "wez.wezterm", "Git.Git" ]
scoop_packages  = [ "sox", "neovim", "fzf" ]

[arch]
packages = [ "zsh", "eza", "ripgrep" ]
```

### 2. 智能两级 `Ctrl + C` 中断与故障审计
全平台启动引擎（`./launch.sh` 与 `.\start.ps1`）均内置两级按键中断与执行审计状态机：
- **单击 `Ctrl + C`**：仅中断并跳过当前正在执行/下载卡住的单个子步骤，自动记入跳过清单，流水线无缝执行下一步；
- **1 秒内连按 `Ctrl + C`**：彻底终止整个流程，并立即输出《安装与部署审计报告》（清晰列出成功项、跳过项、失败项及补救重试提示）。

### 3. 本地私有环境变量隔离 (`~/.zshrc.local`)
若需配置仅在单机生效且不希望提交到 Git 的敏感环境变量（如 API Token、内部代理）：

```bash
# ~/.zshrc.local
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```
`.zshrc` 会在完成基础加载后自动静默引入该文件。

---

## 🔤 推荐字体

全平台推荐安装搭配 [subframe7536/maple-font](https://github.com/subframe7536/maple-font) 中的 **`Maple Mono NF CN`**（Maple Mono 包含 Nerd Fonts 图标与中文字符集），享受最佳的等宽连字弧度与排版对齐体验。  
*(注：Windows 端执行 `.\start.ps1 install` 会自动通过 Scoop 一键安装该字体)*。

---

## 💖 鸣谢与致敬

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm 工业级细节调优与平滑 URL 处理设计借鉴。
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) — Pi Coding Agent 扩展体系架构参考。
- [BarryYangi/chezmoi-dotfiles](https://github.com/BarryYangi/chezmoi-dotfiles) — 模块化 Zsh 与系统分流设计参考。
