# SrP-Dotfiles

> **A unified, modern, declarative, and cross-platform Dotfiles configuration ecosystem.**

<p align="left">
  <b>English</b> •
  <a href="README_zh.md"><b>中文说明</b></a>
</p>

---

SrP-Dotfiles utilizes a **Single Branch (`main`) + Declarative Manifest (`manifest.toml`) + Twin Master Control Engines (`launch.sh` / `start.ps1`)** architecture. It provides first-class native support for both **Unix-like environments (Arch Linux, WSL 2, Debian/Ubuntu, Android Termux)** and **Windows host systems (Windows 10/11)**.

---

## ✨ Key Features

- 🎯 **Single Source of Truth (`manifest.toml`)**: Centralized declaration of system packages, domestic mirrors, global npm tools, and symlink targets across Arch, Debian, Termux, and Windows. Add or remove dependencies without modifying any shell scripts.
- 🛡️ **Resilient Pipeline & Execution Audit**:
  - **Fail-and-Ask Error Handling**: When network timeouts or command errors occur, choose `[s] Skip`, `[r] Retry`, or `[a] Abort` on the fly to prevent pipeline crashes.
  - **Two-Stage `Ctrl + C` Interrupt**: Single press `Ctrl + C` skips the current hanging step and continues the pipeline; press `Ctrl + C` twice within 1.2s to cleanly abort and immediately print the full audit summary.
  - **Audit Ledger**: Outputs a structured *Deployment Audit Report* after execution, detailing successful, skipped, and failed tasks with retry commands.
  - **Safe Backup Archiving**: Automatically backs up conflicting existing configurations with timestamps to `~/.dotfiles_backup/`.
- 🐧 **Modern Unix Suite (`launch.sh`)**:
  - **Modular Zsh (`zsh.d/`)**: Decoupled into environment variables, Oh My Zsh plugins, Spaceship theme, Git aliases, modern CLI replacements, and OS-specific scripts.
  - **Terminal Power Tools**: Integrated Zellij multiplexer, Yazi file manager, Btop system monitor, Fastfetch system info, and lightweight Vim configuration.
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
├── manifest.toml          # 🧠 Central brain: declarative packages, buckets & symlinks
│
├── 🚀 Cross-Platform Twin Engines
│   ├── launch.sh          # Unix master engine (Interactive menu, install, symlink & audit)
│   └── start.ps1          # Windows master engine (Interactive menu, Winget/Scoop, symlink & audit)
│
├── 🐧 Unix Configuration Suite
│   ├── .zshrc             # Zsh entrypoint (symlinked to ~/.zshrc)
│   ├── .vimrc             # Lightweight Vim configuration (symlinked to ~/.vimrc)
│   ├── zsh.d/             # Modular Zsh scripts
│   │   ├── env.zsh        # Environment variables, NVM, PATH, Locale & Editor
│   │   ├── omz.zsh        # Oh My Zsh plugins & Spaceship theme
│   │   ├── git.zsh        # Git aliases, shortcuts & GPG/SSH commit signing
│   │   ├── aliases.zsh    # Modern CLI aliases (eza, bat, fd) & directory navigation
│   │   ├── tools.zsh      # Zellij, Yazi, Zoxide & FZF integrations
│   │   └── os/            # OS-specific adaptations (Arch/WSL, Debian, Termux)
│   ├── btop/              # Btop monitor (Catppuccin Mocha theme)
│   ├── fastfetch/         # Fastfetch system info configuration
│   ├── yazi/              # Yazi terminal file manager configuration & plugins
│   └── zellij/            # Zellij terminal multiplexer layouts & keybindings
│
├── 🪟 Windows Configuration Suite
│   ├── wezterm/           # WezTerm terminal configuration (.wezterm.lua) & background
│   └── powershell/        # Windows PowerShell 7 global profile template ($PROFILE)
│
└── 🤖 Pi Agent Architecture
    ├── pi/settings.json.example # Secure runtime configuration template
    ├── pi/AGENTS.md       # Global agent behavioral & safety rules
    ├── pi/extensions/     # Custom extensions (srp-image, srp-voice, srp-memory, etc.)
    ├── pi/skills/         # Custom agent skills
    ├── pi/prompts/        # Structured prompt templates
    └── scripts/merge_pi_settings.js # Safe settings.json merge tool
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
# Full pipeline: install tools & deploy symlinks
.\start.ps1 all

# Install tools only (based on manifest.toml [windows])
.\start.ps1 install

# Deploy configuration symlinks only (WezTerm, PowerShell Profile, configs)
.\start.ps1 config

# Force overwrite mode
.\start.ps1 config -Force
```

---

## ⌨️ Productivity Shortcuts Cheat Sheet

### WezTerm (Windows)

| Shortcut | Action | Description |
| :--- | :--- | :--- |
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

### 1. Declarative Package Management (`manifest.toml`)
To install new packages on any platform, append the package identifier to `manifest.toml` without touching any script:

```toml
[windows]
winget_packages = [ "wez.wezterm", "Git.Git" ]
scoop_packages  = [ "sox", "neovim", "fzf" ]

[arch]
packages = [ "zsh", "eza", "ripgrep" ]
```

### 2. Intelligent Two-Stage `Ctrl + C` Interrupt
Both `./launch.sh` and `.\start.ps1` feature a built-in signal state machine:
- **Single `Ctrl + C`**: Gracefully interrupts and skips the currently hanging step (e.g. slow network download) and moves seamlessly to the next step.
- **Double `Ctrl + C` (within 1.2s)**: Completely aborts the execution pipeline and instantly prints the *Deployment Audit Report*.

### 3. Local Private Environment Isolation (`~/.zshrc.local`)
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
