# SrP-Dotfiles

> **A unified, modern, declarative, and cross-platform Dotfiles configuration ecosystem.**

<p align="left">
  <b>English</b> •
  <a href="README_zh.md"><b>中文说明</b></a>
</p>

---

SrP-Dotfiles utilizes a **Single Branch (`main`) + Declarative Manifest (`manifest.json`) + Thin Dispatch Entrypoints (`launch.sh` / `start.ps1`) + Declarative Deploy Layer (`scripts/`)** architecture. It provides first-class native support for both **Unix-like environments (Arch Linux, WSL 2, Debian/Ubuntu, Android Termux)** and **Windows host systems (Windows 10/11)**.

> **Design principle: entrypoints only dispatch, the manifest only declares, and only special cases get a script.**
> Adding a new app config = adding one entry to `configs` in `manifest.json`; a dedicated deploy script is needed only for multi-target routing or other special logic.

---

## ✨ Key Features

- 🎯 **Single Source of Truth (`manifest.json`)**: Packages, domestic mirrors, global npm tools and **deployment instructions** declared in one place. New packages need zero script changes; new config entries need exactly one line.
- 🧩 **Three Deploy Verbs**: Every config entry collapses into `link` (symlink, edits apply live), `copy` (overwrite copy, no backup), or `custom` (special-case script). The entrypoints never grow.
- 📖 **Fully Controllable**: To answer “what exists, where does it go, how do I change it”, you only read `manifest.json`.
- 🛡️ **Resilient Pipeline & Execution Audit**:
  - **Fail-and-Ask Error Handling**: When network timeouts or command errors occur, choose `[s] Skip`, `[r] Retry`, or `[a] Abort` on the fly to prevent pipeline crashes.
  - **Two-Stage `Ctrl + C` Interrupt**: Single press `Ctrl + C` skips the current hanging step and continues the pipeline; press `Ctrl + C` twice within 1.2s to cleanly abort and immediately print the full audit summary.
  - **Audit Ledger**: Outputs a structured *Deployment Audit Report* after execution, detailing successful, skipped, and failed tasks with retry commands.
  - **Safe Backup Archiving**: Automatically backs up conflicting existing configurations with timestamps to `~/.dotfiles_backup/`.
- 🐧 **Modern Unix Suite (`launch.sh`)**:
  - **Modular Zsh (`zsh/`)**: Decoupled into environment variables, Oh My Zsh plugins, Spaceship theme, Git aliases, modern CLI replacements, and OS-specific scripts.
  - **Terminal Power Tools**: Integrated Zellij and tmux multiplexers (shared `i/j/k/l` navigation), Yazi file manager, Btop system monitor, Fastfetch system info, and lightweight Vim configuration.
  - **WSL & Termux Enhancements**: Seamless Windows clipboard bridge in WSL; automatic Nerd Font injection in Android Termux.
- 🪟 **Industrial-Grade Windows Workflow (`start.ps1`)**:
  - **Tuned WezTerm Configuration**: Low-power 30 FPS rendering, crisp classic blinking block cursor, smart URL parsing & regex cleanup, keyboard-driven QuickSelect (`Alt+Ctrl+u`), and instant custom wallpaper toggle (`Alt+/`).
  - **PowerShell 7 Profile**: 100% aligned with Unix Git/GitHub CLI workflows (`ghci`, `pr`, `grbom`, `gfrb`, `gcam`, `gst`), directory sync for Yazi (`yz`), and quick navigation (`proj`, `dir`, `clone`, `grt`).
  - **Scoop Acceleration**: Automatic configuration of Nanjing University (NJU) mirrors and Aria2 multi-threaded download acceleration.
  - **Graceful Privilege Degradation**: Prioritizes native symbolic links; safely falls back to file copying if Developer Mode is disabled.
- 🤖 **Pi Coding Agent Deep Integration**: Global agent safety standards (`AGENTS.md`), custom extension suite (Image Generation, Streaming Voice ASR, Long-Term Memory, Multi-Pane Subagents, Vision, Web Extraction), and prompt/skill toolchains.

---

## 📂 Repository Topology

```text
srp-dotfiles/
├── manifest.json          # 🧠 Central brain: packages, buckets & deploy instructions
│
├── 🚀 Thin Dispatch Entrypoints (parse manifest → dispatch → audit ledger)
│   ├── launch.sh          # Unix entrypoint (~650 lines)
│   └── start.ps1          # Windows entrypoint (~640 lines)
│
├── 🧩 Declarative Deploy Layer (how the entrypoints execute each config)
│   └── scripts/
│       ├── lib/                      # Deploy primitives ("how", reusable, never run alone)
│       │   ├── deploy.sh             # Unix deploy verbs: link / copy
│       │   ├── deploy.ps1            # Windows deploy verbs: link / copy
│       │   ├── manifest.js           # Unix manifest reader (node)
│       │   ├── manifest.ps1          # Windows manifest reader (ConvertFrom-Json)
│       │   └── pi-inject-packages.js # Expands @repo tokens into settings.packages
│       └── configs/                  # Special-case configs ("who"; one per method:custom)
│           ├── pi.sh                 # Matches { "name": "pi", "method": "custom" }
│           └── pi.ps1
│
├── 🐧 Unix Configuration Suite
│   ├── vim/               # Lightweight Vim configuration
│   │   └── vimrc          # Vim entrypoint (symlinked to ~/.vimrc)
│   ├── zsh/               # Modular Zsh configuration
│   │   ├── zshrc          # Zsh entrypoint (symlinked to ~/.zshrc)
│   │   ├── env.zsh        # Environment variables, NVM, PATH, Locale & Editor
│   │   ├── omz.zsh        # Oh My Zsh plugins & Spaceship theme
│   │   ├── git.zsh        # Git aliases, shortcuts & GPG/SSH commit signing
│   │   ├── aliases.zsh    # Modern CLI aliases (eza, bat, fd) & directory navigation
│   │   ├── tools.zsh      # Zellij, Yazi, Zoxide & FZF integrations
│   │   └── os/            # OS-specific adaptations (Arch/WSL, Debian, Termux)
│   ├── btop/              # Btop monitor (Catppuccin Mocha theme)
│   ├── fastfetch/         # Fastfetch system info configuration
│   ├── yazi/              # Yazi terminal file manager configuration & plugins
│   ├── zellij/            # Zellij terminal multiplexer layouts & keybindings
│   └── tmux/              # tmux config with Zellij-style Ctrl+p / Ctrl+t key tables
│
├── 🪟 Windows Configuration Suite
│   ├── wezterm/           # WezTerm terminal configuration (wezterm.lua) & background
│   ├── powershell/        # Windows PowerShell 7 global profile template ($PROFILE)
│   └── code/              # VS Code settings template & custom styling assets
│
└── 🤖 Pi Agent Architecture
    ├── pi/settings.json.example # Runtime template (if JSON exists, preserve it and save template as .json.example)
    ├── pi/mcp.json.example # MCP server template (create JSON if missing; otherwise save as .json.example)
    ├── pi/keybindings.json.example # Keybindings template (create JSON if missing; otherwise save as .json.example)
    ├── pi/AGENTS.md       # Global agent behavioral & safety rules
    ├── pi/extensions/     # Custom extensions (subagent, custom-providers, tui-asr, image-generate, memory-log, …)
    ├── pi/skills/         # Custom agent skills
    ├── pi/prompts/        # Structured prompt templates
    └── pi/packages/pi-learn  # Local Pi package (**not deployed**; referenced in place via @repo)
```

---

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

---

### 2. Unix Deployment (Linux / WSL / Termux)

Launch the interactive console menu:

```bash
./launch.sh
```

Or run non-interactively with CLI arguments:

```bash
# Auto-detect OS and run full pipeline (install + symlink deployment) [Recommended]
./launch.sh all

# Install dependencies only via system package managers (Pacman / Apt / Pkg / npm / skills)
./launch.sh install

# Deploy and synchronize Dotfiles symlinks only
./launch.sh config

# Force overwrite mode (skip conflict prompts)
./launch.sh config -f

# Explicitly specify target distribution
./launch.sh install arch
```

> **Apply changes**: Restart your terminal or run `source ~/.zshrc`.

---

### 3. Windows Deployment (PowerShell 7 / Windows Terminal)

In PowerShell 7, navigate to the cloned directory:

```powershell
# Launch interactive console menu [Recommended]
.\start.ps1
```

Or run directly with subcommands:

```powershell
# Full pipeline: install tools & deploy configs (overwrite copy)
.\start.ps1 all

# Install tools only (based on the windows section of manifest.json)
.\start.ps1 install

# Deploy configs only (WezTerm, PowerShell Profile, etc.)
.\start.ps1 config

# Force overwrite mode
.\start.ps1 config -Force
```

---

## ⌨️ Productivity Shortcuts Cheat Sheet

### WezTerm (Windows)

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Ctrl + Shift + t` / `Alt + t`** | **New Tab** | Spawn a new tab and focus it immediately |
| **`Ctrl + Shift + w` / `Alt + w`** | **Close Current Tab** | Instantly close active tab without prompt |
| **`Alt + 1 ~ 4`** | **Activate Tab 1 ~ 4** | Jump directly to specific tabs |
| **`Ctrl + Tab`** | **Cycle Next Tab** | Relative next tab navigation |
| **`Ctrl + Shift + Tab`** | **Cycle Prev Tab** | Relative previous tab navigation |
| **`Alt + /`** | **Toggle Background Image** | Toggle between custom background image and pure black focus mode |
| **`Alt + f`** | **Terminal Search** | Full-screen interactive search across terminal scrollback |
| **`F2`** | **Command Palette** | Fuzzy-search all WezTerm commands and actions (VSCode style) |
| **`Alt + Ctrl + u`** | **QuickSelect URL** | Highlight URLs on screen; press assigned label to open in browser |
| **`Ctrl + Left Click`**| **Open Link** | Click any link to open; automatically trims surrounding brackets |
| **`F1`** | **Vi Copy Mode** | Navigate scrollback with keyboard and copy text |

### PowerShell 7 & Zsh Aligned Commands

| Command | Target Action | Description |
| :--- | :--- | :--- |
| `yz` | **Yazi CWD Sync** | Open Yazi file manager; synchronizes shell CWD upon exit |
| `proj [name]` | **Project Jump** | Jump to `~/Projects` or a specific project subfolder |
| `grt` | **Git Root** | Instantly return to the top-level directory of current Git repo |
| `clone <url>` | **Clone & Enter** | Clone a Git repository and automatically `cd` into its directory |
| `clonep <url>`| **Clone & VS Code**| Clone repo under `~/Projects` and open immediately in VS Code |
| `ghci` | **GitHub CI Status** | Run `gh run list -L 1` to check latest GitHub Actions workflow status |
| `pr [ls \| id]` | **GitHub PR Quick** | List pull requests (`pr ls`) or checkout PR (`pr <id>`) |
| `grbom` | **Git Rebase Main** | Auto-detect `origin/main` or `origin/master` and rebase |
| `gfrb` | **Fetch & Rebase** | Run `git fetch origin` and rebase on default remote branch |
| `gcam "msg"` | **Git Add & Commit**| Stage all changes and commit with message |
| `gcfg <name> <mail>` | **Git Config User** | Quickly configure global Git user name and email |

---

## 🛠️ Advanced Customization

### 1. Add a Package (`manifest.json` → per-OS `packages` / `scoopPackages` …)

```json
"arch":    { "packages": ["zsh", "eza", "ripgrep"] }
"windows": { "wingetPackages": ["wez.wezterm"], "scoopPackages": ["sox", "fzf"] }
```

### 2. Add an App Config (`manifest.json` → per-OS `configs`)

Append one entry to that OS's `configs` array — **no script changes required**:

```json
{ "name": "starship", "method": "link", "source": "starship", "target": "~/.config/starship" }
```

Three deploy verbs:

| `method` | Meaning | Required fields |
| :--- | :--- | :--- |
| `link` | Symlink (repo edits apply live). Conflicting targets are archived to `~/.dotfiles_backup/` | `source` + `target` or `targets` |
| `copy` | **Overwrite copy**: an existing target is deleted and rewritten, **no backup** | `source` + `target` |
| `custom` | Run `scripts/configs/<name>.sh` / `.ps1` | none |

Optional fields:

| Field | Purpose |
| :--- | :--- |
| `targets` | Multiple targets instead of `target`, e.g. `~/.config` **and** `%APPDATA%` on Windows |
| `exclude` | Top-level entries to skip when linking a directory |
| `ifMissing` | The only exception switch for `copy`: skip when the target exists (`-f` still overwrites) |
| `when` | Skip the whole entry when this path is absent (e.g. btop not yet installed by Scoop) |

Path placeholders: `~`, `%APPDATA%`, `$SCOOP`, `$PROFILE`.

### 3. Add a Special-Case Config (multi-target routing / name resolution)

Write a script only when `link` / `copy` cannot express what you need (e.g. Pi fans out to 5 locations and allowlists extensions):

```bash
scripts/configs/<name>.sh     # Unix
scripts/configs/<name>.ps1    # Windows
```

Scripts can reuse the verb library (`source ../lib/deploy.sh` → `link_item` / `copy_item`) and run standalone for debugging:

```bash
bash scripts/configs/pi.sh
```

### 4. Deploy Semantics at a Glance

| Config entry | Verb | Resulting form |
| :--- | :--- | :--- |
| `zshrc` / `vimrc` / `btop` / `fastfetch` / `yazi` / `zellij` / `tmux` | `link` | One symlink under `~/.config/<name>` pointing at the repo; edits apply live |
| `pi` | `custom` | Real copies under `~/.pi/agent/`; `.example` templates check for the destination JSON and preserve it when present |
| `piCliLinks` (inside `pi`) | `link` | `~/.pi/agent/bin/<name>` symlinks pointing at the **deployed** extension copy, so a CLI and the extension pi loads never drift apart |

Pi's configuration templates check whether the destination JSON already exists:

- If the JSON is **missing**, the template is copied without `.example` to create `settings.json`, `mcp.json`, or `keybindings.json`.
- If the JSON **exists**, it is preserved and the template is copied beside it as `*.json.example`.
- `piPackages` is injected only into a newly generated `settings.json`; the sidecar example remains an untouched copy of the template.

The same rule applies to `code/settings.json.example` (Windows target: `%APPDATA%/Code/User/settings.json`). If a `*.json.example` sidecar already exists, it is refreshed from the repository template; the actual JSON remains untouched.

So: **new `settings.json` files get `packages` from the manifest; existing user configuration is never merged or rewritten.**
After deleting a skill/extension from the repo, the stale copy in the target is **not deleted automatically** — the deploy prints a `目标里存在仓库中已不存在的项` line so you can clean it up deliberately.

#### Local Pi packages are not copied

| Package type | Where Pi stores it | What we declare |
| :--- | :--- | :--- |
| `npm:` | Pi installs into `~/.pi/agent/npm/node_modules/` | the npm source name |
| `https://` / `git:` | Pi clones into `~/.pi/agent/git/<host>/<repo>` | the URL |
| **Local path** | **loaded in place, never copied** | `@repo/pi/packages/pi-learn` |

`@repo/` is a deploy-time token expanded by `pi-inject-packages.js` into the absolute repo path,
so it survives cloning anywhere. Edit the package in the repo and restart Pi — no redeploy needed.

> Pi does **not** scan something like `~/.pi/agent/packages/` — packages can only be declared through the
> `packages` field in `settings.json`. Earlier versions copied local packages into that directory; that is now gone.

#### MCP Config Uses pi's Built-in Implementation

pi ships with built-in MCP and reads `~/.pi/agent/mcp.json` (project-level: `.pi/mcp.json`).
This repo's `pi/mcp.json.example` creates `mcp.json` when it is missing; if it already exists, the template is saved as `mcp.json.example` beside it.

> ⚠️ Installing the `pi-mcp-adapter` extension **replaces the built-in support** — pi then stops
> reading `mcp.json` and `/mcp` belongs to the extension. That is why `piPackages` no longer includes it.
> The old `~/.config/mcp/mcp.json` is the **adapter's** path, which the built-in never reads; it is deprecated.

Never commit secrets: `env` supports `${VAR}` references, e.g. `"MINERU_API_TOKEN": "${MINERU_API_TOKEN}"`,
with the real value in `~/.zshrc.local`. When the variable is unset, `pi mcp list` reports it explicitly
instead of silently sending a placeholder.

`~/.pi/agent/mcp.json` is also written by pi itself (`/mcp` UI, `pi mcp add/remove`). If it exists,
deployment preserves it and saves the repository template as `mcp.json.example` beside it.

#### Extension CLIs are exposed on `PATH` (`piCliLinks`)

Some extensions ship a command-line entry point next to their Pi tool. `subagent`, for example,
ships `subagent.ts` (`spawn` / `status` / `send` / `wait` / `stop` / `list`) which its bundled skill
invokes through bash. Such commands are declared per OS:

```json
"piCliLinks": ["subagent=extensions/subagent/subagent.ts"]
```

Each entry becomes a symlink under `~/.pi/agent/bin/` — a directory pi already prepends to the bash
tool's `PATH`. The link points at the **deployed** copy rather than the repository source: the CLI
writes the run metadata that the loaded extension reads, so both sides must always be the same build.

Unix only for now. Windows would need a `.cmd` shim instead of a symlink, so `piCliLinks` is omitted
from the `windows` section.

### 5. Intelligent Two-Stage `Ctrl + C` Interrupt
Both `./launch.sh` and `.\start.ps1` feature a built-in signal state machine:
- **Single `Ctrl + C`**: Gracefully interrupts and skips the currently hanging step (e.g. slow network download) and moves seamlessly to the next step.
- **Double `Ctrl + C` (within 1.2s)**: Completely aborts the execution pipeline and instantly prints the *Deployment Audit Report*.

### 6. Local Private Environment Isolation (`~/.zshrc.local`)
For machine-specific sensitive variables (API tokens, private proxies) that should never be committed to Git:

```bash
# ~/.zshrc.local
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-..."
```
`.zshrc` automatically sources this file silently upon startup.

---

## 🔤 Recommended Font

We recommend installing [Maple Mono NF CN](https://github.com/subframe7536/maple-font) (Maple Mono with Nerd Fonts icons and Chinese glyphs) for clean ligatures and terminal alignment.  
*(Note: Windows setup via `.\start.ps1 install` automatically installs this font via Scoop)*.

---

## 💖 Acknowledgements

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — Reference for WezTerm tuning, smooth URL cleanup, and QuickSelect design.
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) — Reference for Pi Coding Agent extension architecture.
- [BarryYangi/chezmoi-dotfiles](https://github.com/BarryYangi/chezmoi-dotfiles) — Reference for modular Zsh architecture and OS branching.
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code visual asset (`code/VSCode-Thick.png`) created by [Aikoyori](https://github.com/Aikoyori), licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) for non-commercial use with attribution.
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — Original artist for terminal & editor background wallpapers:
  - VS Code background artwork (`code/background.png`): [CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - WezTerm background artwork (`wezterm/background.png`): [CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
