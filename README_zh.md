# SrP-Dotfiles

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

`install.sh` / `install.ps1` 只检查 Python 并启动 `scripts/main.py`；缺失时打印上述命令后退出。

## 快速开始

在线执行（缺少仓库时自动克隆到 `~/.srp-dotfiles`）：

```bash
curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -a -y
```

```powershell
irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 | iex
```

本地执行：

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/Projects/srp-dotfiles
cd ~/Projects/srp-dotfiles

./install.sh                  # 交互菜单
./install.sh -a -y            # 安装 + 部署，全部自动确认
./install.sh -i -y            # 仅安装依赖
./install.sh -c -f            # 仅部署配置，不备份
./install.sh --os arch        # 显式指定目标
./install.sh --dry-run -a -y  # 只打印计划
```

```powershell
.\install.ps1                 # 交互菜单
.\install.ps1 -a -y           # 安装 + 部署
.\install.ps1 -c -f           # 仅部署配置
.\install.ps1 -a -y -Lang zh  # 中文界面（默认英文）
```

默认逐个步骤确认（显示“核心 / 可选”标记）；`-y` 一键同意，标准输入不是终端时必须显式指定。
缺少依赖的步骤（npm、skills 等）会提示并跳过，不会中断整体流程。

## 选择性安装

`--catalog` 以 JSON 输出具体的 apps、configs 与镜像 profile：

```bash
./install.sh --catalog --os arch
```

用 `--apps`、`--configs` 精确选择；镜像有自己的 profile 与覆盖参数：

```bash
./install.sh -a -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror-profile cn
```

- App ID：`pkg:<name>`（Unix）、`winget:<id>`、`scoop:<name>`、`font:<name>`、`npm:<name>`、`skill:<item>`。
- Config ID 就是 `manifest/<os>.json` 里的 `name`。
- 镜像：`--mirror-profile cn` 选择预设；`--mirror-<name> <value>` 覆盖单项（`github`、`npm`、
  `pypi`、`go`、`scoop`），`--proxy <url>` 覆盖代理；`none` 清空。未覆盖时仍使用
  `manifest/mirror.json` 的值。
- 省略某个参数表示全选；传 `none` 表示全不选。

## 目录

```text
.
├── install.sh / install.ps1     # 极简入口：检查 Python -> scripts/main.py
├── scripts/
│   ├── main.py                  # CLI、菜单、编排
│   ├── lib/                     # 清单、镜像、网络、步骤器、部署、安装逻辑
│   └── configs/                 # Python 编写的特殊部署步骤
├── manifest/
│   ├── arch|debian|fedora|termux|windows.json
│   └── mirror.json              # 镜像与代理
├── config/                      # 各软件配置
│   └── zsh/ vim/ tmux/ powershell/ pi/ wezterm/ windows-terminal/ zellij/ yazi/ btop/ fastfetch/ code/
└── worker/                      # 可选：Cloudflare Worker 安装入口
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
| `/health` | 健康检查 |

```bash
python scripts/gen_catalog.py     # 根据 manifest 刷新 worker/public/catalog.json
cd worker
npx wrangler deploy
```

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -a -y
```

```powershell
irm https://dot.srprolin.com | iex
```

页面只是参数生成器：只拼 `--apps/--configs/--mirror-*`，安装与校验仍在 `scripts/main.py`。
Mirrors 区有 profile 下拉与可编辑输入框：切 profile 生成 `--mirror-profile`，改字段生成
`--mirror-<name>`，未修改的值仍使用目标机器的 `manifest/mirror.json`。Worker 拉取的脚本仍会在
目标机器克隆仓库；需要 Git 镜像时用 `SRP_REPO_URL`。

## CI 与部署

`.github/workflows/` 下有两个工作流：

- `ci.yml` — Python 3.9/3.12 编译、单测、catalog 校验、CLI dry-run，以及 Worker 语法与路由测试。
- `deploy.yml` — push 到 `main` 且改动 `worker/**`、`scripts/**` 或 `manifest/**` 时（或手动触发）：
  校验 catalog、跑 Worker 测试，然后通过 `cloudflare/wrangler-action` 部署。

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
- 用 `--mirror-profile cn` 切换；文件里的 `profile` 决定默认值。
- 用 `--mirror-<name>` 覆盖单项（`github`、`npm`、`pypi`、`go`、`scoop`）或 `--proxy <url>`
  覆盖代理。列表用逗号分隔，`none` 表示清空。

| 字段 | 类型 | 作用范围 |
| :--- | :--- | :--- |
| `githubProxy` | 数组 | GitHub release、raw 脚本、`git clone`、GitHub 托管的 Scoop bucket；按顺序回退 |
| `npmRegistry` | 字符串 | `npm` / `npx` |
| `pypiIndex` | 字符串或数组 | pip / uv 源（首个为 index，其余为 extra） |
| `goProxy` | 字符串 | `GOPROXY`，可直接写 `...,direct` |
| `scoopBuckets` | 数组或对象 | Scoop bucket（Windows） |

顶层 `proxy` 对所有下载生效（`socks5://` 或 `http(s)://`），不属于 profile。
系统包管理器（`pacman` / `apt` / `dnf` / `pkg` / `winget`）不覆盖。`install` 阶段还会持久化
pip（`~/.config/pip/pip.conf` / `%APPDATA%\pip\pip.ini`），并在检测到 `go` 时写入
`go env -w`。Scoop 不支持路径前缀镜像，配置 GitHub 代理或 `proxy` 后 Maple 字体改为直接下载。

## 定制

**加软件** — 写入对应 OS 清单：

```json
{ "packages": ["starship"], "scoopPackages": ["starship"] }
```

**加配置项** — 追加到 `configs`：

```json
{ "name": "starship", "method": "link", "source": "config/starship", "target": "~/.config/starship" }
```

| `method` | 含义 | 必填 |
| :--- | :--- | :--- |
| `link` | 软链到仓库，改仓库即时生效；冲突归档到 `~/.dotfiles_backup_*` | `source` + `target`/`targets` |
| `copy` | 覆盖式复制，不备份 | `source` + `target` |
| `custom` | 执行 `scripts/configs/<name 中 - 换成 _>.py` 的 `run(ctx)` | — |

可选字段：`targets`、`exclude`、`ifMissing`、`when`。
路径占位符：`~`、`%APPDATA%`、`%LOCALAPPDATA%`、`$SCOOP`、`$PROFILE`。

自定义模块会收到包含 `repo`、`os_name`、`manifest`、`mirrors`、`backup_dir`、`force`、`runner`
的上下文，可直接调用 `lib.deploy`。Windows Terminal 就是这样的模块：只覆盖模板声明的字段，
保留 `defaultProfile` / `profiles.list`。

## 字体

`install` 会在两个平台自动安装 [Maple Mono NF CN](https://github.com/subframe7536/maple-font)；失败不中断流程，并提示检查 `manifest/mirror.json`。

## 鸣谢与致敬

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm 调优参考。
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code 素材（`config/code/VSCode-Thick.png`），遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — 背景插画：
  - `config/code/background.png`：[CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - `config/wezterm/background.png`：[CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
