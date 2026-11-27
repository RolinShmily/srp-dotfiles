# SrP-Dotfiles

[English](README.md) | **[简体中文](README.zh-CN.md)**

跨平台 dotfiles 与一站式安装配置工具，用一个 Python 入口搞定 **Arch**、**Debian / Ubuntu**、**Fedora**、**Termux** 和 **Windows** 的软件安装与配置部署。

## 这是什么

- **一键装软件和字体**：调用系统包管理器（`pacman`、`apt`、`dnf`、`pkg`、`winget`、`scoop`）安装常用工具，并自动部署终端与界面字体（`Maple Mono NF CN`、`Inter`、`Source Han Sans SC`）。
- **干净地部署配置**：将开箱即用的配置（`zsh`、`powershell`、`vim`、`tmux`、`zellij`、`yazi`、`btop`、`fastfetch`、`code`、`pi`）**复制**到 `$HOME`。覆盖前会自动把旧配置备份到 `~/.dotfiles_backup_*`，部署完成后不依赖原仓库目录。
- **按需勾选、支持镜像与代理**：可以全量安装，也可以只选自己要的软件或配置；内置国内镜像预设（`--mirror cn`）与代理支持（`--proxy`）。

## 环境要求

只需要 **Python 3.9+**（纯标准库实现，无需 `pip install` 任何依赖）：

```bash
# Arch
sudo pacman -S --needed python
# Debian / Ubuntu
sudo apt install -y python3
# Fedora
sudo dnf install -y python3
# Termux
pkg install python
# Windows
winget install Python.Python.3.12
```

> **Windows 没有 `winget`？** LTSC、Windows Sandbox 或 Server 默认不带应用安装程序，可从 [Microsoft Store](https://apps.microsoft.com/detail/9NBLGGH4NNS1) 安装，或直接通过 [python.org](https://www.python.org/downloads/windows/)、`scoop install python` 或 `uv` 安装 Python：
>
> ```powershell
> powershell -c "irm https://astral.sh/uv/install.ps1 | iex"; uv python install 3.12
> ```

请始终以**普通用户**身份运行，不要用 `sudo` 或 root：配置会写入当前用户的 `$HOME`，安装器仅在执行系统包管理命令时按需提权。

## 怎么使用

### 在线一键运行

Linux / Termux：

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -y
```

Windows PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

> 不想全装？打开可视化配置器 **[dot.srprolin.com/config](https://dot.srprolin.com/config)**，直接勾选需要的软件、配置和镜像，复制生成的命令运行即可。

### 本地克隆运行

```bash
git clone https://github.com/RolinShmily/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles

./install.sh              # 交互模式：逐步确认
./install.sh -y           # 全部自动确认
./install.sh -c           # 只部署配置，不装软件
./install.sh --dry-run -y # 只预览执行计划，不做实际修改
```

Windows PowerShell 5.1 默认执行策略为 `Restricted`，先对当前会话放开即可：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1             # 交互模式
.\install.ps1 -y          # 全部自动确认
.\install.ps1 -c          # 只部署配置
```

### 按需选择与镜像 / 代理

```bash
# 查看当前系统支持的软件 ID、配置名与镜像预设
./install.sh --catalog --os arch

# 只装指定软件和配置，并启用国内镜像
./install.sh -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror cn

# 走本地代理（不写协议头时会自动探测 http / socks5）
./install.sh -y --proxy 127.0.0.1:7890
```

- `--apps none` 或 `--configs none` 可完全跳过对应项。
- 默认每个步骤都会询问确认，非交互环境（如管道运行）请加上 `-y`。
- 在线引导若直连 GitHub 失败，会自动回退到 Worker 仓库归档及内置 GitHub 镜像。

## 文档导航

本地构建、测试、Worker 部署、自定义扩展与完整规范均放在 `docs/` 目录（英文文档）：

| 文档 | 内容说明 |
| :--- | :--- |
| [Development](docs/development.md) | 本地开发、测试命令、catalog 生成、Worker 部署、CI 工作流及新增软件/配置/字体指南 |
| [Architecture](docs/architecture.md) | 仓库目录结构、核心模块职责、引导与部署流程、Worker 架构 |
| [Design](docs/design.md) | 设计原则、滚动更新模式、配置优先级、磁盘持久化副作用与权衡取舍 |
| [Reference](docs/reference.md) | 完整 CLI 参数、App/Config ID 规范、Manifest/Mirror/Catalog Schema、字体清单与 Worker 路由 |

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解本地检查与 issue/PR 流程。

## 鸣谢与致敬

- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code 素材（`configs/code/VSCode-Thick.png`），遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — 背景插画：
  - `configs/code/background.png`：[CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)

第三方许可证原文与归属说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
