# srp-dotfiles

个人 macOS 环境配置文件仓库。通过符号链接（Symlink）将仓库内的配置文件部署至系统的主目录及 `~/.config` 目录。

---

## 目录结构

```text
srp-dotfiles/
├── config/              # ~/.config/ 目标映射目录
│   ├── btop/            # Btop 资源监控配置
│   ├── fastfetch/       # Fastfetch 系统硬件摘要配置
│   ├── kitty/           # Kitty 终端模拟器配置
│   ├── nvim/            # Neovim (AstroNvim v4) 代码编辑器配置
│   ├── yazi/            # Yazi 终端文件管理器配置
│   └── zellij/          # Zellij 终端复用器配置
├── home/                # ~/ 主目录映射配置
│   ├── .zshrc           # Zsh 配置文件
│   └── .hushlogin       # 静音登录文件
├── config.sh            # 配置文件部署与软链接更新脚本
├── install.sh           # macOS (Homebrew) 环境依赖安装脚本
└── README.md            # 项目说明文档
```

---

## 配置文件与软件映射

| 模块 / 类别 | 软件名称 | 项目 / 官方链接 | 仓库中配置文件路径 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- |
| **Shell 环境** | Zsh | [zsh-users/zsh](https://github.com/zsh-users/zsh) | `home/.zshrc` | 终端 Shell 主配置文件 |
| | Oh My Zsh | [ohmyzsh/ohmyzsh](https://github.com/ohmyzsh/ohmyzsh) | `home/.zshrc` | Zsh 配置扩展框架 |
| | Spaceship Prompt | [spaceship-prompt/spaceship-prompt](https://github.com/spaceship-prompt/spaceship-prompt) | `home/.zshrc` | Zsh 终端提示符主题 |
| | zsh-autosuggestions | [zsh-users/zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) | `home/.zshrc` | 命令历史自动补全 |
| | zsh-syntax-highlighting | [zsh-users/zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting) | `home/.zshrc` | 命令语法高亮 |
| **CLI 增强工具** | eza | [eza-community/eza](https://github.com/eza-community/eza) | `home/.zshrc` | `ls` 替代工具，支持图标与 Git 状态 |
| | zoxide | [ajeetdsouza/zoxide](https://github.com/ajeetdsouza/zoxide) | `home/.zshrc` | 路径跳转工具 |
| | fzf | [junegunn/fzf](https://github.com/junegunn/fzf) | `home/.zshrc` | 命令行模糊搜索工具 |
| | bat | [sharkdp/bat](https://github.com/sharkdp/bat) | `home/.zshrc` | `cat` 替代工具，支持语法高亮 |
| | fd | [sharkdp/fd](https://github.com/sharkdp/fd) | `home/.zshrc` | `find` 替代工具，文件路径搜索 |
| | ripgrep (rg) | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | `home/.zshrc` | 文本内容搜索工具 |
| | GitHub CLI (gh) | [cli/cli](https://github.com/cli/cli) | `home/.zshrc` | GitHub 命令行集成工具 |
| | lazygit | [jesseduffield/lazygit](https://github.com/jesseduffield/lazygit) | `home/.zshrc` | 终端 Git 交互式工具 |
| | jq | [jqlang/jq](https://github.com/jqlang/jq) | `home/.zshrc` | JSON 格式化与提取工具 |
| | tldr | [tldr-pages/tldr](https://github.com/tldr-pages/tldr) | `home/.zshrc` | 命令示例手册工具 |
| **语言与前端工具** | Node.js (nvm) | [nvm-sh/nvm](https://github.com/nvm-sh/nvm) | `home/.zshrc` | Node.js 版本管理工具 |
| | Bun | [oven-sh/bun](https://github.com/oven-sh/bun) | `home/.zshrc` | JavaScript / TypeScript 运行时 |
| | @antfu/ni | [antfu-collective/ni](https://github.com/antfu-collective/ni) | `home/.zshrc` | 智能包管理器别名工具 |
| | live-server | [tapio/live-server](https://github.com/tapio/live-server) | `home/.zshrc` | 轻量静态 Web 服务器 (用于 `serve()` 函数) |
| **代码编辑器** | Neovim | [neovim/neovim](https://github.com/neovim/neovim) | `config/nvim/`<br>`home/.zshrc` | 终端代码编辑器 (AstroNvim 架构) |
| **文件管理** | Yazi | [sxyazi/yazi](https://github.com/sxyazi/yazi) | `config/yazi/`<br>`home/.zshrc` | 终端文件管理器及预览插件 |
| **终端与复用** | Zellij | [zellij-org/zellij](https://github.com/zellij-org/zellij) | `config/zellij/`<br>`home/.zshrc` | 终端复用器 |
| **终端** | Kitty | [kovidgoyal/kitty](https://github.com/kovidgoyal/kitty) | `config/kitty/` | GPU 加速终端模拟器 |
| **系统监控** | Fastfetch | [fastfetch-cli/fastfetch](https://github.com/fastfetch-cli/fastfetch) | `config/fastfetch/` | 系统与硬件信息摘要显示 |
| | Btop | [aristocratos/btop](https://github.com/aristocratos/btop) | `config/btop/` | 终端资源监控工具 |
| | 静音登录 | - | `home/.hushlogin` | 屏蔽登录系统提示 Banner |

---

## 软件依赖与包管理器映射

下表列出各配置模块涉及的核心软件包在 macOS Homebrew (`brew`) 中的包名映射：

| 类别 / 对应模块  | 核心软件 / 依赖 | macOS (`brew`) 包名 | 全局 JS (`npm`) 包名 |
| :--- | :--- | :--- | :--- |
| **Shell 环境** | Zsh 及插件 | `zsh`, `zsh-autosuggestions`, `zsh-syntax-highlighting` | - |
| **CLI 增强工具** | eza, zoxide, fzf, bat, fd, rg, gh, lazygit, jq, tldr | `eza`, `zoxide`, `fzf`, `bat`, `fd`, `ripgrep`, `gh`, `lazygit`, `jq`, `tealdeer` | - |
| **语言与前端工具** | Node.js, Python, @antfu/ni, live-server | `node`, `python` | `@antfu/ni`<br>`live-server` |
| **代码编辑器** | Neovim & 工具链 | `neovim`, `git`, `unzip` | - |
| **文件管理 (Yazi)** | Yazi & 各格式预览依赖 | `yazi`, `chafa`, `imagemagick`, `poppler`, `ffmpeg`, `sevenzip`, `unar`, `exiftool`, `mediainfo`, `zathura`, `zathura-pdf-poppler`, `miller`, `resvg` | - |
| **终端与复用** | Zellij | `zellij` | - |
| **终端** | Kitty | `kitty` | - |
| **系统监控** | Fastfetch, Btop | `fastfetch`, `btop` | - |

---

## 终端字体配置

本仓库的终端配置（包含 Yazi 图标、Spaceship 提示符符号、Kitty 图标、Neovim 等）依赖 Nerd Fonts 字体编码。

* **推荐字体**：[subframe7536/maple-font](https://github.com/subframe7536/maple-font) (**`Maple Mono NF CN`**)
* **字体安装**：
  * **macOS (Homebrew)**：`brew install --cask font-maple-mono-nf-cn`
---

## 部署与使用

### 1. 系统依赖包安装

```bash
./install.sh
```

### 2. 配置文件部署与更新 (`config.sh`)

运行 `config.sh` 脚本建立软链接，将仓库配置文件软链接至系统目标路径：

```bash
./config.sh

# 强制覆盖已存在的非软链接文件
./config.sh --force
```
