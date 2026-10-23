# SrP-Dotfiles

> **Personal dotfiles and declarative environment setup for Linux, WSL, Termux, and Windows.**

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
- 🤖 **Personal Pi Agent Setup**: Safety rules (`AGENTS.md`), settings/MCP/keybindings templates, local skills, and third-party forks. Reusable extensions, prompt templates, and the worktree-studio skill are distributed separately through [pi-kit](https://github.com/RolinShmily/pi-kit).

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
    ├── pi/skills/         # Personal/local skills (loaded in place via @repo/pi/skills)
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

## ⌨️ Shell Command Reference

Repository-defined aliases and functions, excluding Oh My Zsh's built-in aliases. Some commands require the corresponding tools to be installed.

### Zsh ([zshrc](zsh/zshrc))

| Command | Action |
| :--- | :--- |
| `cl` / `e` | Clear the screen / exit the shell |
| `ff` / `lg` / `ze` | Launch Fastfetch / Lazygit / Zellij |
| `t` | Run tmux; e.g. t a -t 0 attaches to a session |
| `cat <file>` | View a file with bat syntax highlighting |
| `find <pattern>` / `fd <pattern>` | Find files with fd; alias fd to fdfind when needed |
| `help <command>` | Show tldr command examples |
| `ls` / `l` | List directory entries / one entry per line |
| `ll` / `la` | Detailed listing / include hidden entries |
| `lt` | Show a two-level directory tree |
| `lm` / `lmd` | Sort by modification time / reverse order |
| `yz [path]` | Open Yazi and sync the shell directory on exit |
| `proj [name]` | Enter the projects root or a project; override the root with `PROJECTS_DIR` |
| `dir <path>` | Create a directory and enter it (not a directory listing) |
| `clone <url> [dir]` | Clone a repository and enter it |
| `clonep <url>` | Clone under the projects root, open in VS Code, then return to the projects root |
| `codep [name]` | Open a project under the projects root in VS Code, then return |
| `serve` | Start a live-server static server |
| `grt` | Enter the current Git repository root |
| `gs` | `git status` |
| `gd` / `gdc` | Show working-tree / staged diffs; use diff-so-fancy when available |
| `gl` / `glo` | Commit log / one-line graph |
| `glp [n]` | Show the log without a pager, optionally limited to n commits |
| `gp` / `gpft` | Push / push with associated annotated tags |
| `gpf` | `git push --force` (rewrites remote history; use with care) |
| `gpl` | `git pull --rebase` |
| `gcl` | `git clone`, without changing directory |
| `gst` | `git stash` (not status) |
| `grm` / `grmc` | `git rm` / `git rm --cached` |
| `gmv` | `git mv` |
| `main` | Check out the local main branch |
| `gco <branch>` / `gcob <branch>` | Check out / create and check out a branch |
| `gb` / `gbd <branch>` | List branches / delete a merged branch |
| `grb` / `grbc` | `git rebase` / `git rebase --continue` |
| `grbom` | Rebase onto origin's default branch, with main/master fallback |
| `gfrb` | Fetch origin, then rebase onto its default branch |
| `grh` / `grh1` | Reset the index to HEAD / move back one commit; keep working-tree files |
| `ga <path>` / `gA` | Stage paths / all changes (case-sensitive) |
| `gc` / `gcm "msg"` | `git commit` / commit with a message |
| `gca` | `git commit -a`, including tracked-file changes |
| `gcam "msg"` | Stage all changes and commit with a message |
| `gxn` / `gx` | Preview / delete untracked files and directories (gx is irreversible; use with care) |
| `gcfg <name> <email>` | Set the global Git user name and email |
| `gssh [pubkey]` | Enable SSH commit signing globally; find a local public key if omitted |
| `ggpg <key-id>` | Enable GPG commit signing globally; show setup hints if omitted |
| `gsha` | Copy the full HEAD SHA, or print it if no clipboard tool is available |
| `ghci` | Show the latest GitHub Actions run |
| `pr ls` / `pr <id>` | List pull requests / check out a pull request |

### PowerShell 7 ([profile.ps1](powershell/profile.ps1))

| Command | Action |
| :--- | :--- |
| `cl` / `e` | Clear the screen / exit the shell |
| `ff` / `lg` / `ze` | Launch Fastfetch / Lazygit / Zellij |
| `cat <file>` | View a file with bat syntax highlighting |
| `find <pattern>` | Find files with fd |
| `help <command>` | Show tldr command examples |
| `which <command>` | Find a command's source or path |
| `ls` / `l` | List directory entries / one entry per line |
| `ll` / `la` | Detailed listing / include hidden entries |
| `lt` | Show a two-level directory tree |
| `lm` / `lmd` | Sort by modification time / reverse order |
| `yz [path]` | Open Yazi and sync the shell directory on exit |
| `proj [name]` | Enter the projects root or a project; override the root with `PROJECTS_DIR` |
| `dir <path>` | Create a directory and enter it (not a directory listing) |
| `clone <url> [dir]` | Clone a repository and enter it |
| `clonep <url>` | Clone under the projects root, open in VS Code, then return |
| `codep [name]` | Open a project in VS Code, then return |
| `serve` | Start a live-server static server |
| `grt` | Enter the current Git repository root |
| `gs` | `git status` |
| `gd` / `gdc` | Show working-tree / staged diffs; use diff-so-fancy when available |
| `gl` / `glo` | Commit log / one-line graph |
| `glp [n]` | Show the log without a pager, optionally limited to n commits |
| `gp` / `gpft` | Push / push with associated annotated tags |
| `gpf` | `git push --force` (rewrites remote history; use with care) |
| `gpl` | `git pull --rebase` |
| `gcl` | `git clone`, without changing directory |
| `gst` | `git stash` (not status) |
| `grm` / `grmc` | `git rm` / `git rm --cached` |
| `gmv` | `git mv` |
| `main` | Check out the local main branch |
| `gco <branch>` / `gcob <branch>` | Check out / create and check out a branch |
| `gb` / `gbd <branch>` | List branches / delete a merged branch |
| `grb` / `grbc` | `git rebase` / `git rebase --continue` |
| `grbom` | Rebase onto origin's default branch, with main/master fallback |
| `gfrb` | Fetch origin, then rebase onto its default branch |
| `grh` / `grh1` | Reset the index to HEAD / move back one commit; keep working-tree files |
| `ga` / `gA` | Both currently run git add -A (PowerShell is case-insensitive; the later definition wins) |
| `gc` / `gcm "msg"` | `git commit` / commit with a message |
| `gca` | `git commit -a`, including tracked-file changes |
| `gcam "msg"` | Stage all changes and commit with a message |
| `gxn` / `gx` | Preview / delete untracked files and directories (gx is irreversible; use with care) |
| `gunlock` | Remove a stale .git/index.lock only when no Git process is running |
| `gfix-crlf` | Renormalize and stage tracked files under the current directory according to .gitattributes |
| `gcfg <name> <email>` | Set the global Git user name and email |
| `gssh [pubkey]` | Enable SSH commit signing globally; find a local public key if omitted |
| `ggpg <key-id>` | Enable GPG commit signing globally; show setup hints if omitted |
| `ghci` | Show the latest GitHub Actions run |
| `pr ls` / `pr <id>` | List pull requests / check out a pull request |
| `ssh-copy-id user@host [-i key.pub] [-p port]` | Append a local SSH public key to remote authorized_keys (-i takes a public key) |

PowerShell's listings and file viewing prefer eza and bat, falling back to built-in commands. With no arguments, `pr` lists pull requests.

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

### 3. Add a Special-Case Config

Use a dedicated script only when `link` / `copy` cannot express the behavior. Scripts can reuse the deployment functions in `scripts/lib/`:

```text
scripts/configs/<name>.sh     # Unix
scripts/configs/<name>.ps1    # Windows
```

For example, [pi.sh](scripts/configs/pi.sh) / [pi.ps1](scripts/configs/pi.ps1) initializes missing JSON files, preserves existing configs with template sidecars, and injects OS-specific resource paths. More Pi configuration and extensions are maintained in [pi-kit](https://github.com/RolinShmily/pi-kit).

### 4. Deploy Semantics at a Glance

| Config entry | Verb | Resulting form |
| :--- | :--- | :--- |
| `zshrc` / `vimrc` / `btop` / `fastfetch` / `yazi` / `zellij` / `tmux` | `link` | One symlink under `~/.config/<name>` pointing at the repo; edits apply live |
| `windows-terminal-settings` | `custom` | Partially overwrites Windows Terminal settings while preserving machine-generated `defaultProfile` / `profiles.list` |

Windows Terminal does not use a normal whole-file `copy`: the template omits machine-specific `defaultProfile` and `profiles.list`. When the target `settings.json` exists, only fields declared by the template are recursively overwritten; all other target fields are preserved. A missing target is created directly from the template.

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
- [amosblomqvist/learn](https://github.com/amosblomqvist/learn) — Upstream learning system for the third-party `pi-learn` fork retained in this repository; adapted locally for Windows and Zellij.
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code visual asset (`code/VSCode-Thick.png`) created by [Aikoyori](https://github.com/Aikoyori), licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) for non-commercial use with attribution.
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — Original artist for terminal & editor background wallpapers:
  - VS Code background artwork (`code/background.png`): [CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - WezTerm background artwork (`wezterm/background.png`): [CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
