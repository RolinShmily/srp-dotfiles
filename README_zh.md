# SrP-Dotfiles

[English](README.md) | **[简体中文](README_zh.md)**

声明式跨平台 dotfiles。一个 Python 入口完成依赖安装与配置部署，支持 Arch / Debian / Fedora / Termux / Windows。

## 依赖

安装器本身只要求 **Python 3.9+**：

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

Windows 上 `winget` 由「应用安装程序 (App Installer)」提供，LTSC、Windows Sandbox 与 Server 默认没有；
可从 Microsoft Store 安装：

```text
https://apps.microsoft.com/detail/9NBLGGH4NNS1
```

没有 Store 时，用 `winget-cli` 的 release，或完全绕开 winget：
[python.org](https://www.python.org/downloads/windows/)、`scoop install python`、uv：

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"; uv python install 3.12
```

`install.sh` / `install.ps1` 只检查 Python 并启动 `scripts/main.py`；缺失时打印这些选项后退出。

## 快速开始

在线执行（缺少仓库时自动克隆到 `~/.srp-dotfiles`）：

```bash
curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -y
```

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

本地执行：

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/Projects/srp-dotfiles
cd ~/Projects/srp-dotfiles

./install.sh                  # 逐项确认，安装并部署全部
./install.sh -y               # 同上，全部自动确认
./install.sh -c               # 仅部署配置
./install.sh --os arch        # 显式指定目标
./install.sh --dry-run -y     # 只打印计划
```

```powershell
# Windows PowerShell 5.1 默认 Restricted，先只对当前会话放开：
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1              # 逐项确认，安装并部署全部
.\install.ps1 -y           # 同上，全部自动确认
.\install.ps1 -c           # 仅部署配置
```

默认全量运行还会把当前用户策略设为 `RemoteSigned`，之后新开的会话可直接运行 `.\install.ps1`。

默认逐个步骤确认（显示“核心 / 可选”标记）；`-y` 一键同意，标准输入不是终端时必须显式指定。
缺少依赖的步骤（npm、skills 等）会提示并跳过，不会中断整体流程。

GitHub 不可达时，引导脚本会依次回退到 Worker 的仓库归档、`ghfast.top` / `gh-proxy.com`，最后才直连；可用 `SRP_GH_PROXY`、`SRP_REPO_URL`、`SRP_REPO_TARBALL` 指定。

配置一律用 **复制** 部署，之后不再依赖仓库。目标已存在时先归档到 `~/.dotfiles_backup_*`。源缺失会让该步骤失败，安装器以非零码退出。

## 选择性安装

`--catalog` 以 JSON 输出具体的 apps、configs 与镜像 profile：

```bash
./install.sh --catalog --os arch
```

用 `--apps`、`--configs` 精确选择；镜像有自己的 profile 与覆盖参数：

```bash
./install.sh -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror cn
```

- App ID：`pkg:<name>`（Unix）、`winget:<id>`、`scoop:<name>`、`font:<name>`、`npm:<name>`、`skill:<item>`。
- Config ID 就是 `manifest/<os>.json` 里的 `name`。
- 镜像：`--mirror cn` 选择预设；`--mirror-<name> <value>` 覆盖单项（`github`、`npm`、
  `pypi`、`go`、`scoop`），`--proxy <url>` 覆盖代理；`none` 清空。未覆盖时仍使用
  `manifest/mirror.json` 的值。
- 省略某个参数表示全选；传 `none` 表示全不选。

## 文档

完整指南见 [docs/](docs/README.md)：开发、架构、设计与参考规范。

## 目录

```text
.
├── install.sh / install.ps1     # 极简入口：检查 Python -> scripts/main.py
├── scripts/
│   ├── main.py                  # CLI 与编排
│   ├── lib/                     # 清单、镜像、网络、步骤器、部署、安装逻辑
├── manifest/
│   ├── arch|debian|fedora|termux|windows.json
│   └── mirror.json              # 镜像与代理
├── configs/                     # 各软件配置
│   └── zsh/ vim/ tmux/ powershell/ pi/ wezterm/ windows-terminal/ zellij/ yazi/ btop/ fastfetch/ code/
├── worker/                      # 可选：Cloudflare Worker 安装入口
└── docs/                        # 开发、架构、设计、参考规范
```

## 安装入口（可选）

`worker/` 是 Cloudflare Worker + 静态配置页面，以 Workers Route 方式部署在 `dot.srprolin.com/*`
（需要在 `srprolin.com` zone 中为 `dot` 建一条 proxied DNS 记录）：

| 路径 | 用途 |
| :--- | :--- |
| `/` | Windows / PowerShell 客户端返回 `install.ps1`，其余返回 `install.sh` |
| `/install.sh`、`/install.ps1` | 显式脚本（`?os=windows` / `?os=unix` 强制目标） |
| `/config` | 勾选组件并生成安装命令的页面 |
| `/api/catalog` | 页面使用的 apps/configs/mirrors catalog（与 `--catalog` 同构） |
| `/repo.tar.gz`、`/repo.zip` | 仓库归档（引导兜底） |
| `/health` | 健康检查 |

```bash
python scripts/gen_catalog.py     # 根据 manifest 刷新 worker/public/catalog.json
cd worker
npx wrangler@4 deploy
```

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -y
```

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

页面只是参数生成器：只拼 `--apps/--configs/--mirror-*`，安装与校验仍在 `scripts/main.py`。
Mirrors 区有 profile 下拉与可编辑输入框：切 profile 生成 `--mirror`，改字段生成
`--mirror-<name>`，未修改的值仍使用目标机器的 `manifest/mirror.json`。Worker 拉取的脚本仍会在
目标机器克隆仓库；需要 Git 镜像时用 `SRP_REPO_URL`。

## CI 与部署

`.github/workflows/` 下有三个工作流：

- `ci.yml` — Python 3.9/3.12 编译、单测、catalog 校验、CLI dry-run，以及 Worker 语法与路由测试。
- `deploy.yml` — push 到 `main` 且改动 `worker/**`、`scripts/**` 或 `manifest/**` 时（或手动触发）：
  校验 catalog、跑 Worker 测试，然后通过 `cloudflare/wrangler-action` 部署。
- `release.yml` — push `v*` tag（或用已有 tag 手动触发）时：从 [CHANGELOG.md](CHANGELOG.md)
  提取对应版本内容，创建或更新 GitHub Release。

部署前在仓库 Secrets 中配置：

| Secret | 用途 |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | 具备 Workers Scripts:Edit、`srprolin.com` 的 Workers Routes:Edit 与 Zone:Read 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

本地等价命令：

```bash
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
node worker/test.mjs
```

修改 manifest 后记得跑一次 `python scripts/gen_catalog.py`，否则 CI/部署会卡在 catalog 校验。


## 镜像与代理

`manifest/mirror.json` 由顶层 `proxy` 和命名 profile 组成：

```json
{
  "profile": "global",
  "profiles": {
    "global": {},
    "cn": { "githubProxy": ["..."], "npmRegistry": "..." }
  }
}
```

- `global` 是默认 profile，留空即系统/上游默认。
- `cn` 预置 GitHub / npm / pip / Go / Scoop 镜像。
- 用 `--mirror cn` 切换；文件里的 `profile` 决定默认值。
- 用 `--mirror-<name>` 覆盖单项（`github`、`npm`、`pypi`、`go`、`scoop`）或 `--proxy <url>`
  覆盖代理。列表用逗号分隔，`none` 表示清空。

| 字段 | 类型 | 作用范围 |
| :--- | :--- | :--- |
| `githubProxy` | 数组 | GitHub release、raw 脚本、`git clone`、GitHub 托管的 Scoop bucket；按顺序回退 |
| `npmRegistry` | 字符串 | `npm` / `npx` |
| `pypiIndex` | 字符串或数组 | pip / uv 源（首个为 index，其余为 extra） |
| `goProxy` | 字符串 | `GOPROXY`，可直接写 `...,direct` |
| `scoopBuckets` | 数组或对象 | Scoop bucket（Windows） |

顶层 `proxy` 对所有下载生效，不属于 profile。填 `host:port` 即可，协议头由安装器补：它会探测该端口，
响应 SOCKS5 greeting 就用 `socks5://`，否则用 `http://`；显式写了 `http://`、`https://`、`socks5h://`
等则原样保留。注意 npm 与 winget 不支持 SOCKS，优先用 `http://`（混合端口）。
系统包管理器（`pacman` / `apt` / `dnf` / `pkg` / `winget`）不覆盖。Scoop 不支持路径前缀镜像，
配置 GitHub 代理或 `proxy` 后 Maple 字体改为直接下载。

### 哪些会写入磁盘

| 配置 | 生效方式 | 是否持久 |
| :--- | :--- | :--- |
| `proxy` | 仅进程环境变量 | 否 |
| `githubProxy` | 下载时拼 URL | 否 |
| `npmRegistry` | 进程环境变量 + 每次 `--registry` | 不写 `.npmrc` |
| `pypiIndex`（环境变量） | 本次运行的 `PIP_*` / `UV_*` | 否 |
| `pypiIndex`（配置文件） | `~/.config/pip/pip.conf` / `%APPDATA%\pip\pip.ini` | **是** |
| `goProxy` | `go env -w GOPROXY`（`%APPDATA%\go\env`） | **是**（装了 go 时） |
| `scoopBuckets` | `scoop bucket rm/add` | **是** |

持久化只发生在默认全量运行时，取决于所选 profile 是否有值，**与 `--apps` 无关**：
即使 `--apps none` 也会更新 `pip.conf`。之后改用空 profile 不会自动回滚，需要手动清理：

```bash
pip config unset global.index-url
go env -w GOPROXY=          # 或删除 $GOENV
scoop bucket rm <name>      # 再重新添加默认 bucket
```

## 定制

**加软件** — 写入对应 OS 清单：

```json
{ "packages": ["starship"], "scoopPackages": ["starship"] }
```

**加配置项** — 追加到 `configs`：

```json
{ "name": "starship", "source": "configs/starship", "target": "~/.config/starship" }
```

所有条目都是 **复制**：旧目标先归档到 `~/.dotfiles_backup_*` 再替换，没有别的方式。
可选字段：`targets`、`exclude`、`ifMissing`、`when`。
路径占位符：`~`、`%APPDATA%`、`%LOCALAPPDATA%`、`$SCOOP`、`$PROFILE`。

目录按整棵复制，`~/.pi/agent` 就是这样部署的（Pi 自己会发现 `~/.pi/agent/skills`）。
Windows Terminal 也是普通文件复制：模板不含机器相关字段，所以旧的 `settings.json`
（含 `defaultProfile` / `profiles.list`）会先归档，再被模板替换。

## 字体

`install` 会安装 [Maple Mono NF CN](https://github.com/subframe7536/maple-font)（终端）、
[Inter](https://github.com/rsms/inter)（英文 UI）与
[Source Han Sans SC](https://github.com/adobe-fonts/source-han-sans)（中文 UI），均使用 SIL OFL 1.1。Source Han Sans SC 下载约 95 MB。
Termux 只保留 Maple，因为它只支持单个终端字体。下载遵循 `githubProxy` / `proxy`，失败不中断流程。

## 鸣谢与致敬

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm 调优参考。
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code 素材（`configs/code/VSCode-Thick.png`），遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — 背景插画：
  - `configs/code/background.png`：[CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - `configs/wezterm/background.png`：[CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
