# SrP-Dotfiles

> **统一、现代且声明式驱动的跨平台 Dotfiles 统一配置与开发环境系统。**

<p align="left">
  <a href="README.md"><b>English</b></a> •
  <b>中文说明</b>
</p>

---

SrP-Dotfiles 采用 **单分支（`main`）+ 声明式清单（`manifest.json`）+ 极薄派发入口（`launch.sh` / `start.ps1`）+ 声明式部署层（`scripts/`）** 架构，原生深度适配 **类 Unix 系统（Arch Linux / WSL 2 / Debian / Ubuntu / Android Termux）** 与 **Windows 宿主环境（Windows 10/11）**。

> **设计原则：入口只做派发，清单只放声明，特例才写脚本。**
> 新增一个软件配置 = 在 `manifest.json` 的 `configs` 里加一条；只有需要多路分发等特殊逻辑时，才额外写一个部署脚本。

---

## ✨ 核心特性

- 🎯 **单一真实数据源 (`manifest.json`)**：软件包、国内镜像加速源、npm 全局工具与**部署指示**集中声明。新增软件零改动脚本；新增配置项只需一条声明。
- 🧩 **三个部署动词**：所有配置项收敛为 `link`（软链，改仓库即时生效）、`copy`（覆盖式复制，不备份）与 `custom`（特例脚本）三种方式，入口永不膨胀。
- 📖 **完全可控**：想知道“有什么配置、装到哪里、怎么改”，只需读 `manifest.json` 一个文件。
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
- 🤖 **Pi Coding Agent 深度集成**：内置全局智能体规范（`AGENTS.md`）、自研扩展集（OpenRouter生图、流式语音识别、长期记忆、多Pane子智能体、视觉理解、网页抓取）、提示词与技能工具链。

---

## 📂 仓库目录拓扑

```text
srp-dotfiles/
├── manifest.json          # 🧠 核心大脑：全平台依赖、镜像源、部署指示的唯一声明清单
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
│       │   └── pi-inject-packages.js # 展开 @repo 令牌并写入 settings 的 packages
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
│   │   └── os/            # 操作系统特供片段 (Arch/WSL、Debian、Termux 剪贴板与环境)
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
    ├── pi/extensions/     # 核心扩展体系 (subagent、custom-providers、tui-asr、image-generate、memory-log …)
    ├── pi/skills/         # 自定义技能工具库
    ├── pi/prompts/        # 结构化 Prompt 模板
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
# 全量自动化流水线：环境依赖安装 + 配置覆盖部署
.\start.ps1 all

# 仅安装系统依赖与工具 (基于 manifest.json 的 windows 段)
.\start.ps1 install

# 仅部署并同步配置文件 (WezTerm + PowerShell Profile 等)
.\start.ps1 config

# 强制覆盖模式
.\start.ps1 config -Force
```

---

## ⌨️ 高频快捷键速查

### WezTerm (Windows)

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| **`Ctrl + Shift + t` / `Alt + t`** | **新建标签页 (New Tab)** | 极速新建标签页并立即进入 |
| **`Ctrl + Shift + w` / `Alt + w`** | **关闭当前标签页 (Close Tab)** | 秒关当前活动标签页 (免弹窗二次确认) |
| **`Alt + 1 ~ 4`** | **直达标签页 1 ~ 4** | 极速在不同 Tab 之间直达切换 |
| **`Ctrl + Tab`** | **向后轮转标签页** | 顺序切换至下一个标签页 |
| **`Ctrl + Shift + Tab`** | **向前轮转标签页** | 逆序切换至上一个标签页 |
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

### 1. 加一个软件依赖 (`manifest.json` → 各 OS 段的 `packages` / `scoopPackages` …)

```json
"arch":    { "packages": ["zsh", "eza", "ripgrep"] }
"windows": { "wingetPackages": ["wez.wezterm"], "scoopPackages": ["sox", "fzf"] }
```

### 2. 加一个配置项 (`manifest.json` → 各 OS 段的 `configs`)

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

### 3. 加一个特例配置项（多路分发 / 名称解析）

只有 `link` / `copy` 表达不了的场景才需要脚本（例如 Pi 要分发到 5 个不同位置并按白名单过滤扩展）：

```bash
scripts/configs/<name>.sh     # Unix
scripts/configs/<name>.ps1    # Windows
```

脚本内可复用部署动词库（`source ../lib/deploy.sh` → `link_item` / `copy_item`），也可单独调试：

```bash
bash scripts/configs/pi.sh
```

### 4. 部署语义速查

| 配置项 | 动词 | 落地形态 |
| :--- | :--- | :--- |
| `zshrc` / `vimrc` / `btop` / `fastfetch` / `yazi` / `zellij` / `tmux` | `link` | `~/.config/<name>` 一条指向仓库的软链，改仓库即时生效 |
| `pi` | `custom` | `~/.pi/agent/` 下为真实副本；`.example` 模板先检查正式目标是否存在，存在则保留并旁存模板 |

Pi 的配置模板按正式 JSON 是否已存在来部署：

- 正式 JSON **不存在**：去掉 `.example` 后缀，创建 `settings.json`、`mcp.json` 或 `keybindings.json`。
- 正式 JSON **已存在**：保留用户文件不动，把模板复制为同目录的 `*.json.example`。
- 只有新生成的 `settings.json` 才会注入 manifest 的 `piPackages`；已有配置旁的示例文件保持模板原样。

同一规则也适用于 `code/settings.json.example`（目标为 Windows 的 `%APPDATA%/Code/User/settings.json`）。如果旁边已有 `*.json.example`，部署会用仓库模板更新该示例文件，不会覆盖正式 JSON。

即：新建时 `settings.json` 的 `packages` 由 manifest 决定；用户已有的配置不会被合并或改写。
仓库里删掉一个 skill/extension 后，目标目录里的旧副本**不会自动删除**，部署时会打印一行 `目标里存在仓库中已不存在的项` 提醒你手动清理。

#### 本地 Pi 包不复制

| 包类型 | Pi 如何存放 | 我们的做法 |
| :--- | :--- | :--- |
| `npm:` | Pi 自己装到 `~/.pi/agent/npm/node_modules/` | manifest 里写源即名称 |
| `https://` / `git:` | Pi 自己 clone 到 `~/.pi/agent/git/<host>/<repo>` | manifest 里写 URL |
| **本地路径** | **原地加载，不复制** | manifest 里写 `@repo/pi/packages/pi-learn` |

`@repo/` 是部署时展开的令牌（由 `pi-inject-packages.js` 处理），展开成仓库绝对路径，
所以 clone 到哪里都不会失效。改仓库里的包代码，重启 Pi 即时生效（无需重新部署）。

> Pi **不会**扫描 `~/.pi/agent/packages/` 这类目录 —— 包只能通过 `settings.json` 的 `packages` 字段声明。
> 早期版本曾把本地包复制到该目录，现已废弃。

##### 想用仓库里自带的本地包？

`pi/packages/` 下的两个包体积较大，所以**有意不写进** `manifest.json` 的 `piPackages`，
全新部署不会加载它们。需要哪个就把哪个加回你部署的那个 OS 段：

```jsonc
// manifest.json
"piPackages": [
  // 加上你要用的那个包：
  "@repo/pi/packages/pi-learn",
  "@repo/pi/packages/pi-interactive-subagents",
  "npm:context-mode",
  "npm:pi-antigravity"
]
```

`@repo/` 在部署时展开成 clone 实际所在的路径，所以这行不绑机器。它只会写进**新生成**的
`settings.json`；已存在的会被原样保留，所以要么手动把展开后的绝对路径加进它的 `packages`
数组，要么删掉该文件重新部署，然后重启 pi。

#### MCP 配置走 pi 内置实现

pi 已内置 MCP，读取 `~/.pi/agent/mcp.json`（项目级为 `.pi/mcp.json`）。本仓库的
`pi/mcp.json.example` 在目标 `mcp.json` 不存在时生成该文件；若已存在，则模板另存为同目录的 `mcp.json.example`。

> ⚠️ 安装 `pi-mcp-adapter` 扩展会**顶掉内置支持** —— pi 就不再读 `mcp.json`，`/mcp` 也归该扩展。
> 所以 `piPackages` 里不再包含它。旧的 `~/.config/mcp/mcp.json` 是**适配器的路径，内置实现不读**，已废弃。

密钥不要写进仓库：`env` 支持 `${VAR}` 引用，例如 `"MINERU_API_TOKEN": "${MINERU_API_TOKEN}"`，
真实值放 `~/.zshrc.local`。变量未设置时 pi 会在 `pi mcp list` 里明确报错，不会静默使用占位符。

`~/.pi/agent/mcp.json` 也是 pi 自己会写的文件（`/mcp` 界面、`pi mcp add/remove`）。已有 `mcp.json` 时部署会保留它，并把仓库模板另存为 `mcp.json.example`。

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
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) — Pi Coding Agent 扩展体系架构参考。
- [BarryYangi/chezmoi-dotfiles](https://github.com/BarryYangi/chezmoi-dotfiles) — 模块化 Zsh 与系统分流设计参考。
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code 视觉素材（`code/VSCode-Thick.png`）由 [Aikoyori](https://github.com/Aikoyori) 创作，遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 知识共享许可协议进行署名与非商业性使用。
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — 终端与编辑器专属背景壁纸原创画师：
  - VS Code 背景插画（`code/background.png`）：[CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - WezTerm 背景插画（`wezterm/background.png`）：[CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
