# srp-dotfiles

欢迎来到我的个人 Linux 及类 Unix 环境配置文件（Dotfiles）仓库！

为了更好地适配不同 Linux 发行版的包管理器及环境差异，本仓库采用了**多分支管理**策略。`main` 分支仅作为文档导航，具体的配置文件、部署脚本及安装指南均存放在对应的系统分支中。

---

## 🧭 分支导航

请根据你当前使用的操作系统，切换到对应的分支查看详细的配置说明和安装方法：

### 1. [Arch Linux / WSL 分支 (`arch`)](https://github.com/RolinShmily/srp-dotfiles/tree/arch)
**目标环境**：Arch Linux 原生系统及 Windows Subsystem for Linux (WSL)
**包管理器**：`pacman`
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Yazi (终端文件管理器)
- Zellij (终端复用器)
- Kitty (WSL / GUI 终端)

### 2. [Debian 13 分支 (`debian`)](https://github.com/RolinShmily/srp-dotfiles/tree/debian)
**目标环境**：Debian 13 (Trixie) 及现代 Ubuntu 服务器/虚拟机
**包管理器**：`apt`
**包含核心组件**：
- 精简版现代 CLI 工具链 (依赖官方 Debian 仓库原生支持的工具)
- Neovim (AstroNvim)
- *注：剔除了该发行版未收录或服务器不常用的组件（如 Yazi, Zellij, VS Code 远端配置等），主打稳定轻量。*

### 3. [Termux 分支 (`termux`)](https://github.com/RolinShmily/srp-dotfiles/tree/termux)
**目标环境**：Android 上的 [Termux](https://termux.dev/) 终端模拟器
**包管理器**：`pkg`
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Yazi (终端文件管理器)
- Zellij (终端复用器)
- Fastfetch & Htop (系统监控，以 Htop 替代 Btop)

### 4. [macOS 分支 (`mac`)](https://github.com/RolinShmily/srp-dotfiles/tree/mac)
**目标环境**：Apple Silicon / Intel 芯片的 macOS
**包管理器**：`brew` (Homebrew)
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Kitty (GPU 加速终端模拟器)
- Fastfetch & Btop (系统监控)
- *注：基于 Debian 分支派生，剔除了 Yazi, Zellij 等桌面/服务器差异组件，主打稳定轻量。*

---

## 🛠️ 如何开始？

在使用本仓库前，请先将仓库克隆到本地，然后**签出 (checkout)** 你需要的操作系统分支。

```bash
# 1. 克隆仓库
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/.dotfiles
cd ~/.dotfiles

# 2. 切换到你的目标环境分支 (以 arch 为例)
git checkout arch
# 或者如果是 debian
# git checkout debian
# 或者如果是 termux
# git checkout termux
# 或者如果是 mac
# git checkout mac

# 3. 按照该分支 README.md 中的说明执行部署
```

> **注意**：请勿在 `main` 分支下执行任何安装脚本，因为所有的配置实体均保存在特定分支中。
