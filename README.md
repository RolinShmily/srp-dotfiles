# SrP-Dotfiles

> **A unified, modern, declarative, and cross-platform Dotfiles configuration ecosystem.**

<p align="left">
  <b>English</b> •
  <a href="README_zh.md"><b>中文说明</b></a>
</p>

---

SrP-Dotfiles utilizes a **Single Branch (`main`) + Declarative Manifests (`manifest/<os>.json`) + Thin Dispatch Entrypoints (`launch.sh` / `start.ps1`) + Declarative Deploy Layer (`scripts/`)** architecture. It provides first-class native support for both **Unix-like environments (Arch Linux, WSL 2, Debian/Ubuntu HomeServer/VPS, Android Termux)** and **Windows host systems (Windows 10/11)**.

> **Design principle: entrypoints only dispatch, the manifest only declares, and only special cases get a script.**
> Adding a new app config = adding one entry to `configs` in `manifest/<os>.json`; a dedicated deploy script is needed only for multi-target routing or other special logic.

---

## ✨ Key Features

- 🎯 **Decoupled Declarative Manifests (`manifest/<os>.json`)**: Packages, domestic mirrors, global npm tools and **deployment instructions** declared per OS profile. New packages need zero script changes; new config entries need exactly one line.
- 🧩 **Three Deploy Verbs**: Every config entry collapses into `link` (symlink, edits apply live), `copy` (overwrite copy, no backup), or `custom` (special-case script). The entrypoints never grow.
- 📖 **Fully Controllable**: To answer “what exists, where does it go, how do I change it”, you only read `manifest/<os>.json`.
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
├── manifest/              # 🧠 OS profile manifests (arch.json, debian-vps.json, windows.json ...)
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
│       │   └── pi-inject-resources.js # Expands @repo tokens into Pi settings resources
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
│   │   └── os/            # OS-specific adaptations (Arch/WSL, Debian/Ubuntu, Termux)
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

# Interface language: English by default; use zh for Chinese
./launch.sh --lang zh
./launch.sh all debian-vps --lang en

# Explicitly specify target distribution/profile
./launch.sh install arch
./launch.sh all debian-homeserver  # Full HomeServer profile with Pi Web
./launch.sh all debian-vps          # Minimal VPS profile
```

> When Debian/Ubuntu is auto-detected without a profile, the script asks whether this is a HomeServer or VPS. In non-interactive environments, pass `--os debian-vps` or `--os debian-homeserver` explicitly.

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

# Install tools only (based on manifest/windows.json)
.\start.ps1 install

# Deploy configs only (WezTerm, PowerShell Profile, etc.)
.\start.ps1 config

# Force overwrite mode
.\start.ps1 config -Force

# Interface language: English by default; use zh for Chinese
.\start.ps1 help -Lang en
.\start.ps1 all -Lang zh
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

### 1. Add a Package (`manifest/<os>.json` → `packages` / `scoopPackages` …)

```json
// manifest/arch.json
{ "packages": ["zsh", "eza", "ripgrep"] }

// manifest/windows.json
{ "wingetPackages": ["wez.wezterm"], "scoopPackages": ["sox", "fzf"] }
```

### 2. Add an App Config (`manifest/<os>.json` → `configs`)

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
| `pi` | `custom` | Initializes Pi JSON templates and injects OS-specific `packages` / `extensions` / `skills` / `prompts` paths |
| `windows-terminal-settings` | `custom` | Partially overwrites Windows Terminal settings while preserving machine-generated `defaultProfile` / `profiles.list` |

Windows Terminal does not use a normal whole-file `copy`: the template omits machine-specific `defaultProfile` and `profiles.list`. When the target `settings.json` exists, only fields declared by the template are recursively overwritten; all other target fields are preserved. A missing target is created directly from the template.

Pi deployment initializes a fresh `settings.json` and injects the selected OS profile's `piResources`:

```jsonc
"piResources": {
  "packages": ["npm:pi-antigravity", "@repo/pi/packages/pi-learn"],
  "extensions": ["@repo/pi/extensions/subagent"],
  "skills": ["@repo/pi/skills"],
  "prompts": ["@repo/pi/prompts"]
}
```

`@repo/` is expanded by `pi-inject-resources.js` into an absolute repository path. Local resources are
therefore loaded directly from the checkout; they are not copied or linked into `~/.pi/agent/`.
External `skillsAdd` entries are still installed by the `skills` CLI into `~/.pi/agent/skills`.

| Resource type | Pi setting | Deployment behavior |
| :--- | :--- | :--- |
| External/local Pi packages | `packages` | Pi manages npm, Git and local package sources |
| Repository extensions | `extensions` | Pi loads paths directly from the checkout |
| Repository skills | `skills` | Pi loads paths directly from the checkout |
| Repository prompts | `prompts` | Pi loads paths directly from the checkout |
| External Agent Skills | `skillsAdd` | Installed separately by the `skills` CLI |

For the one-shot deployment flow, the generated `settings.json` is written from the repository template
and the four resource fields are injected for the selected OS. Existing installations are intentionally
outside this migration path and can be cleaned up manually.

#### Local Pi packages and resources

`@repo/` is a deploy-time token, so the same manifest works after cloning the repository elsewhere.
Pi receives the resolved absolute path and loads the local package or resource in place; no
`~/.pi/agent/packages/` copy and no resource symlink are needed.

#### MCP Config Uses pi's Built-in Implementation

pi ships with built-in MCP and reads `~/.pi/agent/mcp.json` (project-level: `.pi/mcp.json`).
This repo's `pi/mcp.json.example` creates `mcp.json` when it is missing; if it already exists, the template is saved as `mcp.json.example` beside it.

> ⚠️ Installing the `pi-mcp-adapter` extension **replaces the built-in support** — pi then stops
> reading `mcp.json` and `/mcp` belongs to the extension. That is why `piResources.packages` no longer includes it.
> The old `~/.config/mcp/mcp.json` is the **adapter's** path, which the built-in never reads; it is deprecated.

Never commit secrets: `env` supports `${VAR}` references, e.g. `"MINERU_API_TOKEN": "${MINERU_API_TOKEN}"`,
with the real value in `~/.zshrc.local`. When the variable is unset, `pi mcp list` reports it explicitly
instead of silently sending a placeholder.

`~/.pi/agent/mcp.json` is also written by pi itself (`/mcp` UI, `pi mcp add/remove`). If it exists,
deployment preserves it and saves the repository template as `mcp.json.example` beside it.

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
