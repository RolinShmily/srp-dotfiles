# SrP-Dotfiles

统一、现代且模块化的跨平台 Dotfiles 配置仓库。

本仓库采用**单分支（`main`）+ 声明式清单（`manifest.toml`）+ 模块化 Zsh（`zsh.d/`）**设计，自动适配 **Arch Linux (WSL/原生)**、**Debian / Ubuntu** 与 **Android (Termux)** 等不同环境。

---

## 🌟 核心特性

- 🚀 **跨平台统一维护**：全平台配置合流于 `main` 分支，多机同步零冲突。
- 📋 **TOML 声明式清单 (`manifest.toml`)**：不同操作系统的软件包、npm 全局工具与部署目标清晰分离。
- 🧩 **模块化 Zsh (`zsh.d/`)**：拆分为环境变量、Oh My Zsh、Git 别名、CLI 工具及系统特供片段，支持 `~/.zshrc.local` 私有环境变量隔离。
- 🤖 **Pi Agent 集成**：内置 Pi Coding Agent 的全局规则、自定义技能（Skills）与扩展（Extensions）。
- 🛠️ **一键式体验 (`launch.sh`)**：自动探测系统环境与 WSL 标识，支持交互式菜单与无交互 CLI 参数调用。

---

## 📁 目录结构

```text
srp-dotfiles/
├── launch.sh              # 统一交互式启动与环境检测总入口
├── install.sh             # 依赖包安装引擎 (基于 manifest.toml)
├── config.sh              # 软链接部署引擎 (基于 manifest.toml)
├── manifest.toml          # 各操作系统软件依赖与配置清单
├── .zshrc                 # Zsh 配置入口 (软链至 ~/.zshrc)
├── .vimrc                 # 原生轻量 Vim 现代化配置 (软链至 ~/.vimrc)
├── zsh.d/                 # 模块化 Zsh 配置片段
│   ├── env.zsh            # 环境变量、NVM、PATH、Locale 与默认编辑器
│   ├── omz.zsh            # Oh My Zsh 插件与 Spaceship 主题
│   ├── git.zsh            # Git 别名、快捷函数与 GPG/SSH 签名配置
│   ├── aliases.zsh        # 现代 CLI 增强 (eza, bat, fd) 与目录导航
│   ├── tools.zsh          # Zellij, Yazi, Zoxide, FZF 深度集成
│   └── os/                # 操作系统特供片段 (剪贴板、特定环境变量)
│       ├── arch.zsh       # Arch / WSL 剪贴板适配
│       ├── debian.zsh     # Debian / Ubuntu 特供
│       └── termux.zsh     # Android Termux 剪贴板
├── btop/                  # Btop 监控配置与 Catppuccin 主题
├── fastfetch/             # Fastfetch 现代系统信息展示配置
├── pi/                    # Pi Coding Agent 配置、Prompts、Extensions、Skills
├── yazi/                  # Yazi 现代终端文件管理器配置与插件
└── zellij/                # Zellij 终端复用器布局与快捷键
```

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

### 2. 一键安装与部署

运行主入口脚本启动交互式菜单：

```bash
./launch.sh
```

或使用命令行参数快速执行：

```bash
# 自动探测系统并完成全部安装与配置部署 (推荐)
./launch.sh all

# 仅安装依赖包
./launch.sh install

# 仅部署配置文件 (软链接)
./launch.sh config

# 强制覆盖已有配置文件
./launch.sh config -f

# 显式指定操作系统安装 (可选: arch | debian | termux)
./launch.sh install arch
```

### 3. 使配置生效

配置部署完成后，重新打开终端或执行：

```bash
source ~/.zshrc
```

---

## 🔒 私有环境变量扩展

若需要配置仅在当前单机生效且不希望提交到 Git 的私有环境变量（如 API Keys、Token 等），只需在用户家目录下创建 `~/.zshrc.local`：

```bash
# ~/.zshrc.local
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```

`.zshrc` 会在加载完所有模块后自动引入 `~/.zshrc.local`。
