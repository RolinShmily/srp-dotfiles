# SrP-Dotfiles

**[English](README.md)** | [简体中文](README.zh-CN.md)

Cross-platform dotfiles with a single Python installer for **Arch**, **Debian / Ubuntu**, **Fedora**, **Termux**, and **Windows**.

## What it does

- **Installs packages & fonts**: uses your OS package manager (`pacman`, `apt`, `dnf`, `pkg`, `winget`, `scoop`) and installs terminal/UI fonts (`Maple Mono NF CN`, `Inter`, `Source Han Sans SC`).
- **Deploys configs cleanly**: copies ready-to-use configs (`zsh`, `powershell`, `vim`, `tmux`, `zellij`, `wezterm`, `yazi`, `btop`, `fastfetch`, `code`, `pi`) into `$HOME`. Existing files are backed up to `~/.dotfiles_backup_*` first, and deployed files do not depend on keeping the repo around.
- **Selective & mirror-friendly**: install everything or pick only specific apps/configs, with built-in mirror presets (`--mirror cn`) and proxy support (`--proxy`).

## Requirements

Only **Python 3.9+** is required (standard library only, nothing to `pip install`):

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

> **Windows without `winget`**: on LTSC, Sandbox, or Server images, install App Installer from the [Microsoft Store](https://apps.microsoft.com/detail/9NBLGGH4NNS1), or install Python directly via [python.org](https://www.python.org/downloads/windows/), `scoop install python`, or `uv`:
>
> ```powershell
> powershell -c "irm https://astral.sh/uv/install.ps1 | iex"; uv python install 3.12
> ```

Run the installer as your **normal user**, not through `sudo` or root — configs are written to `$HOME`, and the script elevates only for individual system package commands.

## Quick start

### Online install

Linux / Termux:

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -y
```

Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

> Prefer picking only what you need? Open the visual configurator at **[dot.srprolin.com/config](https://dot.srprolin.com/config)** to check apps, configs, and mirrors and copy the generated command.

### Local clone

```bash
git clone https://github.com/RolinShmily/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles

./install.sh              # interactive: confirm each step
./install.sh -y           # approve all steps
./install.sh -c           # deploy configs only (skip packages)
./install.sh --dry-run -y # preview the plan without changing anything
```

On Windows PowerShell 5.1 (which defaults to `Restricted` execution policy):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1             # interactive
.\install.ps1 -y          # approve all steps
.\install.ps1 -c          # deploy configs only
```

### Pick apps, configs, or mirrors

```bash
# List available app IDs, config names, and mirror profiles
./install.sh --catalog --os arch

# Install specific apps/configs with the China mirror profile
./install.sh -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror cn

# Use a local proxy (auto-detects http/socks5 when no scheme is given)
./install.sh -y --proxy 127.0.0.1:7890
```

- Pass `none` to `--apps` or `--configs` to skip that category completely.
- By default, every step asks for confirmation; pass `-y` for non-interactive runs.
- If GitHub is unreachable during online bootstrap, the script automatically falls back to the Worker archive and built-in GitHub mirrors.

## Documentation

Full guides for building, customizing, deploying the Worker, and schemas live in `docs/`:

| Guide | What's inside |
| :--- | :--- |
| [Development](docs/development.md) | Local development, tests, catalog generation, Worker deployment, CI workflows, and adding apps/configs/fonts |
| [Architecture](docs/architecture.md) | Repository layout, engine modules, bootstrap & deployment flow, and Worker architecture |
| [Design](docs/design.md) | Core principles, rolling model, precedence rules, disk side effects, and engineering trade-offs |
| [References](docs/references.md) | CLI flags, app/config IDs, manifest/mirror/catalog schemas, fonts, Worker routes, and operational contracts |

## Acknowledgements

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm tuning reference.
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code artwork (`configs/code/VSCode-Thick.png`), [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — background artwork:
  - `configs/code/background.png`: [CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - `configs/wezterm/background.png`: [CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
