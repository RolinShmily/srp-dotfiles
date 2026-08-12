# srp-dotfiles

欢迎来到我的个人 Linux 及类 Unix 环境配置文件（Dotfiles）仓库！

为了更好地适配不同环境（桌面开发、WSL、服务器等）的包管理器及使用场景差异，本仓库采用了**多分支管理**策略。`main` 分支仅作为文档导航，具体的配置文件、部署脚本及安装指南均存放在对应的系统分支中。

---

## 🧭 分支导航

请根据你的**使用场景**，切换到对应的分支查看详细的配置说明和安装方法：

| 分支 | 适用场景 | 包管理器 |
| :--- | :--- | :--- |
| [`arch`](https://github.com/RolinShmily/srp-dotfiles/tree/arch) | WSL 环境（及 Arch 原生系统） | `pacman` |
| [`debian`](https://github.com/RolinShmily/srp-dotfiles/tree/debian) | 服务器环境 | `apt` |
| [`mac`](https://github.com/RolinShmily/srp-dotfiles/tree/mac) | 日常类 Unix 编码环境 | `brew` |
| [`termux`](https://github.com/RolinShmily/srp-dotfiles/tree/termux) | 类服务器 SSH 客户端环境 | `pkg` |

### 1. [Arch Linux / WSL 分支 (`arch`)](https://github.com/RolinShmily/srp-dotfiles/tree/arch)
**适用场景**：Windows 下的 WSL 开发环境（也适用于 Arch Linux 原生系统）
**目标环境**：Arch Linux 及 Windows Subsystem for Linux (WSL)
**包管理器**：`pacman`
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Yazi (终端文件管理器)
- Zellij (终端复用器)

### 2. [Debian 13 分支 (`debian`)](https://github.com/RolinShmily/srp-dotfiles/tree/debian)
**适用场景**：服务器环境（远程运维、生产/开发服务器）
**目标环境**：Debian 13 (Trixie) 及现代 Ubuntu 服务器/虚拟机
**包管理器**：`apt`
**包含核心组件**：
- 精简版现代 CLI 工具链 (依赖官方 Debian 仓库原生支持的工具)
- Neovim (AstroNvim)
- *注：剔除了该发行版未收录或服务器不常用的组件（如 Kitty, Yazi, Zellij 等），主打稳定轻量。*

### 3. [Termux 分支 (`termux`)](https://github.com/RolinShmily/srp-dotfiles/tree/termux)
**适用场景**：类服务器 SSH 客户端环境（通过手机上的 Termux 远程 SSH 登录并管理服务器）
**目标环境**：Android 上的 [Termux](https://termux.dev/) 终端模拟器
**包管理器**：`pkg`
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Yazi (终端文件管理器)
- Zellij (终端复用器)
- Fastfetch & Htop (系统监控，以 Htop 替代 Btop)

### 4. [macOS 分支 (`mac`)](https://github.com/RolinShmily/srp-dotfiles/tree/mac)
**适用场景**：日常类 Unix 编码环境（macOS 桌面开发、日常终端使用）
**目标环境**：Apple Silicon / Intel 芯片的 macOS
**包管理器**：`brew` (Homebrew)
**包含核心组件**：
- 现代 CLI 增强 (eza, zoxide, fzf, ripgrep, bat, fd 等)
- Neovim (AstroNvim)
- Kitty (GPU 加速终端模拟器)
- Fastfetch & Btop (系统监控)

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
