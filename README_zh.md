# SrP-Dotfiles

> **面向 Linux、WSL、Termux 与 Windows 的个人配置仓库，以分系统 JSON 清单管理终端环境和部署。**

<p align="left">
  <a href="README.md"><b>English</b></a> •
  <b>中文说明</b>
</p>

---

SrP-Dotfiles 采用 **单分支（`main`）+ 解耦清单（`manifest/<os>.json`）+ 极薄派发入口（`launch.sh` / `start.ps1`）+ 声明式部署层（`scripts/`）** 架构，原生深度适配 **类 Unix 系统（Arch Linux / WSL 2 / Debian / Ubuntu HomeServer/VPS / Android Termux）** 与 **Windows 宿主环境（Windows 10/11）**。

> **设计原则：入口只做派发，清单只放声明，特例才写脚本。**
> 新增一个软件配置 = 在对应系统的 `manifest/<os>.json` 的 `configs` 里加一条；只有需要多路分发等特殊逻辑时，才额外写一个部署脚本。

---

## ✨ 核心特性

- 🎯 **分系统独立清单 (`manifest/<os>.json`)**：每个操作系统拥有独立的 JSON 清单，软件包、国内镜像加速源、npm 全局工具与**部署指示**各司其职，无需在大清单中混杂。新增软件零改动脚本；新增配置项只需一条声明。
- 🧩 **三个部署动词**：所有配置项收敛为 `link`（软链，改仓库即时生效）、`copy`（覆盖式复制，不备份）与 `custom`（特例脚本）三种方式，入口永不膨胀。
- 📖 **完全可控**：想知道“有什么配置、装到哪里、怎么改”，只需读对应系统的 `manifest/<os>.json` 单个文件。
- 🛡️ **韧性流水线与执行审计报告**：
  - **遇错智能拦截 (Fail-and-Ask)**：网络波动或安装异常时，支持一键 `[s] 跳过`、`[r] 重试` 或 `[a] 终止`，杜绝单点报错导致流程崩溃；
  - **智能两级 `Ctrl + C` 中断**：单次按下 `Ctrl + C` 仅跳过当前卡住的子步骤并平滑继续下一步；1.2 秒内连按两次 `Ctrl + C` 彻底安全终止并立即打印全量审计报表；
  - **部署审计看板**：每次运行结束输出结构化的《安装与部署审计报告》，精准汇总成功、跳过与失败项并提供重试指引；
  - **安全备份机制**：覆盖前自动按时间戳归档旧配置至 `~/.dotfiles_backup/`。
- 🐧 **类 Unix 现代化套件 (`launch.sh`)**：
  - **模块化 Zsh (`zsh/`)**：拆分为环境变量、Oh My Zsh、Spaceship 主题、Git 别名、现代 CLI 增强与操作系统特供片段；
  - **终端利器集成**：Zellij 与 tmux 复用器（统一 i/j/k/l 方向键导航）、Yazi 文件管理器、Btop 性能监控、Fastfetch 系统看板与轻量 Vim；
  - **移动端/WSL 适配**：Android Termux 自动注入 Nerd Font，WSL 剪贴板无缝桥接。
- 🪟 **Windows 工业级工作流 (`start.ps1`)**：
  - **WezTerm 工业级调优**：低功耗 30 FPS 渲染、经典快闪烁方块光标、智能 URL 清洗与全键盘 QuickSelect (`Alt+Ctrl+u`)、专属背景图 / 纯黑底色一键秒切 (`Alt+/`)；
  - **PowerShell 7 + Oh My Posh**：全局 Profile 模板自动覆盖部署，100% 对齐 Unix Git/GitHub CLI 工作流（`ghci`, `pr`, `grbom`, `gfrb`, `gcam`, `gst`），集成 `yz`（Yazi 退出同步目录）、`proj`、`clone`、`grt` 等全套提效函数；
  - **国内镜像源与多线程加速**：Scoop 自动配置南京大学镜像源（main/extras/versions/nerd-fonts）与 Aria2 多线程下载加速；
  - **全覆盖式复制部署**：Windows 端不用符号链接（需开发者模式/管理员权限且行为不一致），所有配置一律覆盖式复制，结果可预期。
- 🤖 **个人 Pi Agent 环境**：维护安全规范（`AGENTS.md`）、settings / MCP / 快捷键模板、本地技能和第三方 fork。通用扩展、提示词及 worktree-studio 技能由独立的 [pi-kit](https://github.com/RolinShmily/pi-kit) 包提供。

---

## 📂 仓库目录拓扑

```text
srp-dotfiles/
├── manifest/              # 🧠 分系统声明清单 (arch.json, debian-vps.json, windows.json ...)
│
├── 🚀 极薄派发入口 (解析清单 → 逐条派发 → 审计账本)
│   ├── launch.sh          # Unix 入口 (~650 行)
│   └── start.ps1          # Windows 入口 (~640 行)
│
├── 🧩 声明式部署层 (入口借助它执行每一个配置项)
│   └── scripts/
│       ├── lib/                      # 部署原语（「怎么做」，可复用，不会自己跑）
│       │   ├── deploy.sh             # Unix 部署动词: link / copy
│       │   ├── deploy.ps1            # Windows 部署动词: link / copy
│       │   ├── manifest.js           # Unix 清单读取 (node)
│       │   ├── manifest.ps1          # Windows 清单读取 (ConvertFrom-Json)
│       │   └── pi-inject-resources.js # 展开 @repo 令牌并写入 Pi settings 资源
│       └── configs/                  # 特例配置项（「谁」，每个 method:custom 一条）
│           ├── pi.sh                 # 对应 manifest 里 { "name": "pi", "method": "custom" }
│           └── pi.ps1
│
├── 🐧 类 Unix 系统配置体系
│   ├── vim/               # 现代轻量 Vim 配置体系
│   │   └── vimrc          # Vim 主配置 (软链至 ~/.vimrc 或复制至 ~/_vimrc)
│   ├── zsh/               # 模块化 Zsh 配置体系
│   │   ├── zshrc          # Zsh 主入口 (软链至 ~/.zshrc)
│   │   ├── env.zsh        # 环境变量、NVM、PATH、Locale 与默认编辑器
│   │   ├── omz.zsh        # Oh My Zsh 插件与 Spaceship 现代主题
│   │   ├── git.zsh        # Git 别名、快捷函数与 GPG/SSH 签名
│   │   ├── aliases.zsh    # 现代 CLI 工具别名 (eza, bat, fd) 与目录导航
│   │   ├── tools.zsh      # Zellij, Yazi, Zoxide, FZF 深度集成
│   │   └── os/            # 操作系统特供片段 (Arch/WSL、Debian/Ubuntu、Termux 剪贴板与环境)
│   ├── btop/              # Btop 性能监控 (Catppuccin Mocha 主题)
│   ├── fastfetch/         # Fastfetch 系统信息美化展示
│   ├── yazi/              # Yazi 现代终端文件管理器配置与插件
│   ├── zellij/            # Zellij 终端复用器布局与键位映射
│   └── tmux/              # tmux 配置，含 Zellij 风格 Ctrl+p / Ctrl+t 键位表
│
├── 🪟 Windows 系统配置体系
│   ├── wezterm/           # WezTerm 现代终端工业级配置 (wezterm.lua) 与专属背景图
│   ├── powershell/        # Windows PowerShell 7 全局 Profile 模板 (整合 Oh-My-Posh)
│   └── code/              # VS Code 配置模板与开屏/背景等静态样式资源
│
└── 🤖 Pi Agent 智能体体系
    ├── pi/settings.json.example # 运行时配置模板 (目标 JSON 已存在时保留原文件，模板另存为 .json.example)
    ├── pi/mcp.json.example # MCP 服务模板 (按目标 JSON 是否存在决定生成 JSON 或旁存 .example)
    ├── pi/keybindings.json.example # 快捷键映射模板 (按目标 JSON 是否存在决定生成 JSON 或旁存 .example)
    ├── pi/AGENTS.md       # 全局智能体通用行为与安全准则
    ├── pi/skills/         # 个人/本地技能（通过 @repo/pi/skills 原地加载，不建软链）
    └── pi/packages/pi-learn  # 本地 Pi 包（**不部署**，由 manifest 以 @repo 路径直接引用）
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

# 界面默认英文；使用 zh 切换为中文
./launch.sh --lang zh
./launch.sh all debian-vps --lang en

# 显式指定操作系统/profile
./launch.sh install arch
./launch.sh all debian-homeserver  # 完整 HomeServer 配置，含 Pi Web
./launch.sh all debian-vps          # 精简 VPS 配置
```

> 自动检测到 Debian/Ubuntu 且未指定 profile 时，脚本会询问选择 HomeServer 或 VPS；在非交互环境中请显式传入 `--os debian-vps` 或 `--os debian-homeserver`。

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
# 全量自动化流水线：环境依赖安装 + 配置覆盖部署
.\start.ps1 all

# 仅安装系统依赖与工具 (基于 manifest/windows.json)
.\start.ps1 install

# 仅部署并同步配置文件 (WezTerm + PowerShell Profile 等)
.\start.ps1 config

# 强制覆盖模式
.\start.ps1 config -Force

# 界面默认英文；使用 zh 切换为中文
.\start.ps1 help -Lang en
.\start.ps1 all -Lang zh
```

---

## ⌨️ Shell 缩写指令

以下列出仓库自定义的别名与函数，不包含 Oh My Zsh 自带别名。部分命令需先安装对应工具。

### Zsh（[zshrc](zsh/zshrc)）

| 指令 | 作用 |
| :--- | :--- |
| `cl` / `e` | 清屏 / 退出 Shell |
| `ff` / `lg` / `ze` | 启动 Fastfetch / Lazygit / Zellij |
| `t` | 启动 tmux，如 `t a -t 0` 连接会话 |
| `cat <file>` | 用 bat 高亮查看文件 |
| `find <pattern>` / `fd <pattern>` | 用 fd 查找文件；仅有 fdfind 时也提供 `fd` 别名 |
| `help <command>` | 查看 tldr 简明用法 |
| `ls` / `l` | 目录列表 / 每行一项 |
| `ll` / `la` | 详细列表 / 详细列表含隐藏项 |
| `lt` | 两层目录树 |
| `lm` / `lmd` | 按修改时间排序 / 反向排序 |
| `yz [path]` | 打开 Yazi，退出时同步当前目录 |
| `proj [name]` | 进入项目根目录或子项目；可用 `PROJECTS_DIR` 自定义根目录 |
| `dir <path>` | 创建目录并进入（不是列目录） |
| `clone <url> [dir]` | 克隆仓库并进入 |
| `clonep <url>` | 克隆到项目根目录并用 VS Code 打开，随后回到项目根目录 |
| `codep [name]` | 用 VS Code 打开项目根目录下的项目，随后返回原目录 |
| `serve` | 启动 `live-server` 静态服务器 |
| `grt` | 进入当前 Git 仓库根目录 |
| `gs` | `git status` |
| `gd` / `gdc` | 查看工作区 / 暂存区差异；可用时启用 diff-so-fancy |
| `gl` / `glo` | 提交日志 / 单行图形日志 |
| `glp [n]` | 不分页显示日志，可限制条数 |
| `gp` / `gpft` | 推送 / 推送并携带关联的附注标签 |
| `gpf` | `git push --force`（会改写远端历史，慎用） |
| `gpl` | `git pull --rebase` |
| `gcl` | `git clone`，不自动进入目录 |
| `gst` | `git stash`（不是 status） |
| `grm` / `grmc` | `git rm` / `git rm --cached` |
| `gmv` | `git mv` |
| `main` | 切换到本地 `main` 分支 |
| `gco <branch>` / `gcob <branch>` | 切换分支 / 创建并切换分支 |
| `gb` / `gbd <branch>` | 查看分支 / 删除已合并分支 |
| `grb` / `grbc` | `git rebase` / `git rebase --continue` |
| `grbom` | 变基到 origin 的默认分支，兼容 `main` / `master` |
| `gfrb` | 先 `fetch origin`，再变基到远端默认分支 |
| `grh` / `grh1` | 重置暂存区到 HEAD / 回退一个提交，均保留工作区文件 |
| `ga <path>` / `gA` | 暂存指定路径 / 全部变更（区分大小写） |
| `gc` / `gcm "msg"` | `git commit` / 指定提交信息 |
| `gca` | `git commit -a`，提交已跟踪文件的修改 |
| `gcam "msg"` | 暂存全部变更并提交 |
| `gxn` / `gx` | 预览 / 执行未跟踪文件与目录清理（`gx` 不可恢复，慎用） |
| `gcfg <name> <email>` | 设置全局 Git 用户名与邮箱 |
| `gssh [pubkey]` | 全局启用 SSH 提交签名；省略路径时查找本机公钥 |
| `ggpg <key-id>` | 全局启用 GPG 提交签名；不传参数时显示配置指引 |
| `gsha` | 复制 HEAD 的完整 SHA；无可用剪贴板工具时直接输出 |
| `ghci` | 查看最近一次 GitHub Actions 运行 |
| `pr ls` / `pr <id>` | 列出 PR / 检出指定 PR |

### PowerShell 7（[profile.ps1](powershell/profile.ps1)）

| 指令 | 作用 |
| :--- | :--- |
| `cl` / `e` | 清屏 / 退出 Shell |
| `ff` / `lg` / `ze` | 启动 Fastfetch / Lazygit / Zellij |
| `cat <file>` | 用 bat 高亮查看文件 |
| `find <pattern>` | 用 fd 查找文件 |
| `help <command>` | 查看 tldr 简明用法 |
| `which <command>` | 查找命令来源或路径 |
| `ls` / `l` | 目录列表 / 每行一项 |
| `ll` / `la` | 详细列表 / 详细列表含隐藏项 |
| `lt` | 两层目录树 |
| `lm` / `lmd` | 按修改时间排序 / 反向排序 |
| `yz [path]` | 打开 Yazi，退出时同步当前目录 |
| `proj [name]` | 进入项目根目录或子项目；可用 `PROJECTS_DIR` 自定义根目录 |
| `dir <path>` | 创建目录并进入（不是列目录） |
| `clone <url> [dir]` | 克隆仓库并进入 |
| `clonep <url>` | 克隆到项目根目录并用 VS Code 打开，随后返回原目录 |
| `codep [name]` | 用 VS Code 打开项目，随后返回原目录 |
| `serve` | 启动 `live-server` 静态服务器 |
| `grt` | 进入当前 Git 仓库根目录 |
| `gs` | `git status` |
| `gd` / `gdc` | 查看工作区 / 暂存区差异；可用时启用 diff-so-fancy |
| `gl` / `glo` | 提交日志 / 单行图形日志 |
| `glp [n]` | 不分页显示日志，可限制条数 |
| `gp` / `gpft` | 推送 / 推送并携带关联的附注标签 |
| `gpf` | `git push --force`（会改写远端历史，慎用） |
| `gpl` | `git pull --rebase` |
| `gcl` | `git clone`，不自动进入目录 |
| `gst` | `git stash`（不是 status） |
| `grm` / `grmc` | `git rm` / `git rm --cached` |
| `gmv` | `git mv` |
| `main` | 切换到本地 `main` 分支 |
| `gco <branch>` / `gcob <branch>` | 切换分支 / 创建并切换分支 |
| `gb` / `gbd <branch>` | 查看分支 / 删除已合并分支 |
| `grb` / `grbc` | `git rebase` / `git rebase --continue` |
| `grbom` | 变基到 origin 的默认分支，兼容 `main` / `master` |
| `gfrb` | 先 `fetch origin`，再变基到远端默认分支 |
| `grh` / `grh1` | 重置暂存区到 HEAD / 回退一个提交，均保留工作区文件 |
| `ga` / `gA` | 当前均为 `git add -A`（PowerShell 不区分大小写，后定义覆盖前者） |
| `gc` / `gcm "msg"` | `git commit` / 指定提交信息 |
| `gca` | `git commit -a`，提交已跟踪文件的修改 |
| `gcam "msg"` | 暂存全部变更并提交 |
| `gxn` / `gx` | 预览 / 执行未跟踪文件与目录清理（`gx` 不可恢复，慎用） |
| `gunlock` | 删除残留 `.git/index.lock`；仅在确认无 Git 进程运行时使用 |
| `gfix-crlf` | 按 `.gitattributes` 重新规范化并暂存当前目录下的已跟踪文件 |
| `gcfg <name> <email>` | 设置全局 Git 用户名与邮箱 |
| `gssh [pubkey]` | 全局启用 SSH 提交签名；省略路径时查找本机公钥 |
| `ggpg <key-id>` | 全局启用 GPG 提交签名；不传参数时显示配置指引 |
| `ghci` | 查看最近一次 GitHub Actions 运行 |
| `pr ls` / `pr <id>` | 列出 PR / 检出指定 PR |
| `ssh-copy-id user@host [-i key.pub] [-p port]` | 将本地 SSH 公钥追加到远端 `authorized_keys`（`-i` 指定公钥） |

PowerShell 的列表和文件查看优先使用 eza、bat，未安装时回退到内置命令；`pr` 不传参数时默认列出 PR。

---

## 🛠️ 进阶定制与扩展

### 1. 加一个软件依赖 (`manifest/<os>.json` → `packages` / `scoopPackages` …)

```json
// manifest/arch.json
{ "packages": ["zsh", "eza", "ripgrep"] }

// manifest/windows.json
{ "wingetPackages": ["wez.wezterm"], "scoopPackages": ["sox", "fzf"] }
```

### 2. 加一个配置项 (`manifest/<os>.json` → `configs`)

在对应 OS 的 `configs` 数组里追加一条即可，**不需要动任何脚本**：

```json
{ "name": "starship", "method": "link", "source": "starship", "target": "~/.config/starship" }
```

三个部署动词：

| `method` | 含义 | 必填字段 |
| :--- | :--- | :--- |
| `link` | 软链接（改仓库文件即时生效）。目标冲突时归档到 `~/.dotfiles_backup/` | `source` + `target` 或 `targets` |
| `copy` | **覆盖式复制**：目标已存在就删除重写，**不备份** | `source` + `target` |
| `custom` | 执行 `scripts/configs/<name>.sh` / `.ps1` | 无 |

通用可选字段：

| 字段 | 作用 |
| :--- | :--- |
| `targets` | 多目标数组，替代 `target`。用于同一配置需同时落 `~/.config` 与 `%APPDATA%` 的场景 |
| `exclude` | `link` 目录时跳过的顶层项 |
| `ifMissing` | `copy` 的唯一例外开关：目标已存在就跳过（`-f` 时仍覆盖） |
| `when` | 该路径不存在则整条跳过（如 Scoop 尚未安装的 btop） |

路径占位符：`~`、`%APPDATA%`、`$SCOOP`、`$PROFILE`。

### 3. 加一个特例配置项

只有 `link` / `copy` 无法表达的场景才需要独立脚本，可复用 `scripts/lib/` 中的部署函数：

```text
scripts/configs/<name>.sh     # Unix
scripts/configs/<name>.ps1    # Windows
```

例如 [pi.sh](scripts/configs/pi.sh) / [pi.ps1](scripts/configs/pi.ps1) 会初始化缺失的 JSON、保留已有配置并旁存模板，再注入当前系统的资源路径。更多 Pi 配置与扩展已整理为 [pi-kit](https://github.com/RolinShmily/pi-kit)。

### 4. 部署语义速查

| 配置项 | 动词 | 落地形态 |
| :--- | :--- | :--- |
| `zshrc` / `vimrc` / `btop` / `fastfetch` / `yazi` / `zellij` / `tmux` | `link` | `~/.config/<name>` 一条指向仓库的软链，改仓库即时生效 |
| `windows-terminal-settings` | `custom` | 局部覆盖 Windows Terminal 设置，保留机器生成的 `defaultProfile` / `profiles.list` |

Windows Terminal 不使用普通的整文件 `copy`：模板不声明机器相关的 `defaultProfile` 和 `profiles.list`；目标已有 `settings.json` 时，只递归覆盖模板中声明的字段，并保留目标中其他未声明字段。目标不存在时才直接用模板创建。

### 5. 智能两级 `Ctrl + C` 中断与故障审计
全平台启动引擎（`./launch.sh` 与 `.\start.ps1`）均内置两级按键中断与执行审计状态机：
- **单击 `Ctrl + C`**：仅中断并跳过当前正在执行/下载卡住的单个子步骤，自动记入跳过清单，流水线无缝执行下一步；
- **1 秒内连按 `Ctrl + C`**：彻底终止整个流程，并立即输出《安装与部署审计报告》（清晰列出成功项、跳过项、失败项及补救重试提示）。

### 6. 本地私有环境变量隔离 (`~/.zshrc.local`)
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
- [amosblomqvist/learn](https://github.com/amosblomqvist/learn) — 本仓库保留的第三方 `pi-learn` fork 的上游学习系统，已在本地适配 Windows 和 Zellij。
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code 视觉素材（`code/VSCode-Thick.png`）由 [Aikoyori](https://github.com/Aikoyori) 创作，遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 知识共享许可协议进行署名与非商业性使用。
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — 终端与编辑器专属背景壁纸原创画师：
  - VS Code 背景插画（`code/background.png`）：[CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - WezTerm 背景插画（`wezterm/background.png`）：[CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
