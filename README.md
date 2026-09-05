# SrP-Dotfiles

统一、现代且声明式驱动的跨平台 Dotfiles 配置系统。

本仓库采用 **单分支（`main`）+ 声明式清单（`manifest.toml`）+ 跨平台双子星总控引擎（`launch.sh` / `start.ps1`）** 架构，原生深度适配 **类 Unix 系统（Arch Linux / WSL / Debian / Ubuntu / Android Termux）** 与 **Windows 宿主环境（Windows 10/11）**。

---

## ✨ 核心特性

- 🌐 **单一真实数据源 (`manifest.toml`)**：不同平台（Arch、Debian、Termux、Windows）的软件包、镜像加速源、npm 全局工具与部署目标集中声明，增删依赖零改动代码。
- 🛡️ **韧性流水线与审计报告**：
  - **遇错智能拦截 (Fail-and-Ask)**：网络波动或安装异常时，支持一键 `[s] 跳过`、`[r] 重试` 或 `[a] 终止`，杜绝单点报错导致流程崩溃；
  - **部署审计看板**：每次运行结束输出结构化的《安装与部署审计报告》，精准汇总成功、跳过与失败项；
  - **安全备份机制**：覆盖前自动按时间戳归档旧配置至 `~/.dotfiles_backup_<timestamp>`。
- 🐧 **类 Unix 现代化套件 (`launch.sh`)**：
  - **模块化 Zsh (`zsh.d/`)**：拆分为环境变量、Oh My Zsh、Git 别名、现代 CLI 增强与操作系统特供片段；
  - **终端利器集成**：Zellij 复用器、Yazi 文件管理器、Btop 性能监控、Fastfetch 系统看板与轻量 Vim；
  - **移动端/WSL 适配**：Android Termux 自动注入 Nerd Font，WSL 剪贴板无缝桥接。
- 🪟 **Windows 工业级工作流 (`start.ps1`)**：
  - **WezTerm 工业级调优**：呼吸感平滑光标 (EaseOut)、智能 URL 清洗与全键盘 QuickSelect (`Alt+Ctrl+u`)、专属背景图 / 纯黑底色一键切换 (`Alt+/`)；
  - **PowerShell 7 + Oh My Posh**：全局 Profile 模板自动软链部署，集成 `yz`（Yazi 退出同步目录）、`proj`、`mkcd`、`grt` 及全套 Git/CLI 增强；
  - **Yazi 现代文件管理器跨平台对齐**：Winget 自动安装 Yazi 与 9 大预览依赖（FFmpeg, 7zip, jq, Poppler, fd, ripgrep, fzf, zoxide, ImageMagick），Windows 下完美支持 Catppuccin 主题与边框；
  - **国内镜像源与多线程加速**：Scoop 自动配置南京大学镜像源（main/extras/versions/nerd-fonts）与 Aria2 多线程下载；
  - **权限优雅降级**：优先建立符号链接（支持开发实时双向同步），无开发者模式时自动安全降级为文件复制。
- 🤖 **Pi Coding Agent 深度集成**：内置全局智能体规范（`AGENTS.md`）、自研扩展集（语音/图像/记忆/子智能体）、提示词与技能工具链。

---

## 📂 仓库目录拓扑

```text
srp-dotfiles/
├── manifest.toml          # 🎯 核心大脑：全平台依赖、镜像源与配置声明式清单
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

## ⌨️ Windows WezTerm 高频快捷键速查

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| **`Alt + /`** | **专属背景图 / 纯黑底色切换** | 默认开启专属背景图，一键秒切纯黑专注模式 |
| **`Alt + f`** | **终端全屏实时搜索** | 高亮检索屏幕与所有回滚历史输出 |
| **`F2`** | **唤起 Command Palette 命令面板** | 类似 VSCode 模糊搜索所有终端操作与设置 |
| **`Alt + Ctrl + u`** | **URL 免鼠标 QuickSelect** | 全屏高亮所有链接，按提示字母一键在浏览器打开 |
| **`Ctrl + 鼠标左键`** | **精准点击打开链接** | 正则自动剥离括号/尖括号，杜绝 404 |
| **`F1`** | **Vi 键盘复制模式 (Copy Mode)** | 纯键盘移动光标选中文本并复制 |

---

## 🔧 进阶定制与扩展

### 1. 声明式扩展新软件 (`manifest.toml`)
无论在哪个平台需要新增软件包，仅需在 `manifest.toml` 对应节中追加名称，无需改动脚本：

```toml
[windows]
winget_packages = [ "wez.wezterm", "Git.Git" ]
scoop_packages  = [ "neovim", "fzf" ]   # 随时追加

[arch]
packages = [ "zsh", "eza", "ripgrep" ] # 随时追加
```

### 2. 本地私有环境变量隔离 (`~/.zshrc.local`)
若需配置仅在单机生效且不希望提交到 Git 的敏感环境变量（如 API Token、内部代理）：

```bash
# ~/.zshrc.local
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```
`.zshrc` 会在完成基础加载后自动静默引入该文件。

---

## 🎨 推荐字体

全平台推荐安装搭配 [subframe7536/maple-font](https://github.com/subframe7536/maple-font) 中的 **`Maple Mono NF CN`**（Maple Mono 包含 Nerd Fonts 图标与中文字符集），享受最佳的等宽连字弧度与排版对齐体验。
*(注：Windows 端执行 `.\start.ps1 install` 会自动通过 Scoop 或 Release 一键安装该字体)*。

---

## 🙏 鸣谢与致敬

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config)：WezTerm 工业级细节调优与平滑光标/URL处理设计借鉴。
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config)：Pi Coding Agent 扩展体系架构参考。
- [BarryYangi/chezmoi-dotfiles](https://github.com/BarryYangi/chezmoi-dotfiles)：模块化 Zsh 与系统分流设计参考。
