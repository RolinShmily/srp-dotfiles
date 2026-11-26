# Architecture

SrP-Dotfiles is a declarative cross-platform installer: JSON manifests describe what packages,
fonts, and configs belong on each OS, and a single standard-library Python engine executes the plan.
There are no OS-specific package lists hidden inside the CLI or Worker.

## Repository layout

```text
.
├── install.sh / install.ps1     # thin bootstrap launchers (Python check, repo fetch/refresh)
├── scripts/
│   ├── main.py                  # CLI parser, catalog export, step orchestration
│   ├── gen_catalog.py           # builds worker/public/catalog.json from manifests
│   ├── lib/
│   │   ├── catalog.py           # app/config/mirror catalog schema & filtering
│   │   ├── manifest.py          # manifest + mirror.json loader & precedence resolver
│   │   ├── platform_info.py     # OS detection, path placeholders, PATHEXT command resolution
│   │   ├── proxy.py             # proxy host:port scheme probing (socks5 vs http)
│   │   ├── net.py               # mirrored GitHub/archive downloads with fallback
│   │   ├── runner.py            # per-step confirmation, retry/skip/abort loop, audit report
│   │   ├── deploy.py            # copy-only config deployment & ~/.dotfiles_backup_* archiving
│   │   ├── installers.py        # pacman/apt/dnf/pkg, winget, scoop, fonts, npm, uv, shell
│   │   ├── context.py           # shared execution context passed to steps
│   │   └── messages.py          # centralized user-facing message templates
│   └── tests/                   # offline unit test suite
├── manifest/
│   ├── arch.json                # Arch Linux packages, fonts, npm/skills, configs
│   ├── debian.json              # Debian / Ubuntu manifest
│   ├── fedora.json              # Fedora manifest (including optional COPRs)
│   ├── termux.json              # Termux (Android) manifest
│   ├── windows.json             # Windows (winget + scoop + fonts + configs) manifest
│   └── mirror.json              # default proxy & named mirror profiles (global, cn)
├── configs/                     # tracked application configs deployed by copy
│   ├── btop/                    # Linux & Windows configs + Catppuccin theme
│   ├── code/                    # VS Code settings, custom CSS, artwork
│   ├── fastfetch/               # fastfetch JSONC config
│   ├── pi/                      # Pi agent AGENTS.md, keybindings, settings
│   ├── powershell/              # PowerShell profile.ps1
│   ├── tmux/                    # tmux.conf
│   ├── vim/                     # vimrc
│   ├── wezterm/                 # wezterm.lua + background artwork
│   ├── yazi/                    # yazi/keymap/theme/package configs & plugins
│   ├── zellij/                  # config.kdl
│   └── zsh/                     # zshrc + modular env/omz/git/aliases/tools/os/
├── worker/                      # Cloudflare Worker endpoint + static /config UI
│   ├── index.js                 # Worker router (scripts, archives, assets, health)
│   ├── wrangler.toml            # route binding (dot.srprolin.com/*) & assets config
│   ├── test.mjs                 # offline Worker & configurator tests
│   └── public/
│       ├── config.html          # visual checkbox configurator
│       ├── app.js               # client-side command builder
│       └── catalog.json         # generated from manifest/*.json
├── docs/                        # development, architecture, design, reference
└── .github/workflows/           # test.yml, deploy.yml
```

## End-to-end execution flow

```text
install.sh / install.ps1
        │  1. Reject root (unless SRP_ALLOW_ROOT=1)
        │  2. Verify Python 3.9+
        │  3. Resolve repo (local / SRP_DOTFILES_DIR / auto-refreshed ~/.srp-dotfiles)
        ▼
scripts/main.py
        │  1. Parse flags (--config, --os, --apps, --configs, --mirror*, --proxy, --dry-run)
        │  2. Load manifest/<os>.json + manifest/mirror.json
        │  3. Resolve concrete selection & build ordered step plan
        ▼
scripts/lib/runner.py
        │  Per-step confirm (or -y), execute, retry / skip / abort, final audit summary
        │
        ├── installers.py   OS packages, Scoop/winget, fonts, npm globals, skills, login shell
        └── deploy.py       backup existing targets -> copy files/directories
```

## Bootstrap & repository resolution

Because `manifest/mirror.json` lives inside the repository, `install.sh` and `install.ps1` cannot
depend on it during initial fetch. Instead, they maintain a small built-in fallback list and choose
one of three repository modes:

1. **`local`**: the script sits inside a working tree containing `scripts/main.py` (or the current
   directory does). Runs directly against that checkout without touching git state.
2. **`explicit`**: `SRP_DOTFILES_DIR` is set. Uses that directory and clones/downloads into it if
   missing.
3. **`auto`**: default for piped online runs (`curl ... | sh`). Manages `~/.srp-dotfiles` and
   refreshes it from `main` on every run so a cached copy cannot silently pin an obsolete installer.

Fetch order when cloning or downloading:
1. Probe each mirror prefix (`SRP_GH_PROXY`, built-in GitHub proxies, then direct GitHub) with a
   short connect timeout before invoking `git clone --depth=1` so dead proxies do not stall git.
2. When `git` is absent or every clone fails, fall back to a repository archive: Worker
   `<origin>/repo.tar.gz` (or `/repo.zip` on Windows), then `SRP_REPO_TARBALL`, then GitHub
   `codeload` (direct and through the same prefixes).

## Engine module responsibilities

| Module | Responsibility |
| :--- | :--- |
| `scripts/main.py` | Argument parsing, `--catalog` output, high-level step scheduling, exit code handling |
| `scripts/lib/manifest.py` | Loads OS manifests and `mirror.json`, validates structure, applies CLI mirror/proxy overrides |
| `scripts/lib/catalog.py` | Expands manifests into stable app IDs (`pkg:`, `winget:`, `scoop:`, `font:`, `npm:`, `skill:`), config IDs, and mirror metadata |
| `scripts/lib/platform_info.py` | Detects target OS, expands path placeholders (`~`, `%APPDATA%`, `$PROFILE`, etc.), resolves bare Windows `.cmd`/`.bat` shims via `PATHEXT` |
| `scripts/lib/proxy.py` | Normalizes `--proxy`: probes bare `host:port` for SOCKS5 vs HTTP and preserves explicit URL schemes |
| `scripts/lib/net.py` | Builds proxied GitHub URL candidate lists (always retaining direct upstream as final fallback) and streams downloads |
| `scripts/lib/runner.py` | Runs steps with interactive confirmation (or `-y`), tracks ok/skipped/failed counts, and prints the end-of-run summary |
| `scripts/lib/deploy.py` | Unlinks legacy symlinks/hard-links, archives existing targets to `~/.dotfiles_backup_*`, and performs real copies |
| `scripts/lib/installers.py` | Platform-specific installers with resilient failure handling: batch-then-per-package retries (`apt`, `pacman`, `pkg`), `--skip-broken` (`dnf`), benign `UPDATE_NOT_APPLICABLE` handling (`winget`), PATH shim updates (`scoop`), font archive extraction, and login shell setup (`chsh` targeting `SUDO_USER`) |
| `scripts/lib/context.py` | Immutable/shared run context (`os`, `dry_run`, `yes`, `mirrors`, `repo_dir`) threaded into steps |
| `scripts/lib/messages.py` | Single-language message catalog verified by `test_messages.py` for 100% key coverage |

## Config deployment model

Configs are deployed strictly by **copy**, never by symlink:

- Existing files or directories at a target path are moved into a timestamped backup directory
  (`~/.dotfiles_backup_*`) before replacement.
- Legacy symlinks or hard-linked targets are unlinked first so the deployed file never shares an
  inode with the repository.
- On Unix, selecting `zshrc` also deploys `zsh-modules` (`configs/zsh/*` → `~/.config/srp-dotfiles/zsh`)
  so `~/.zshrc` keeps working even if the clone is moved or deleted. Private overrides live outside
  the managed directory in `~/.config/srp-dotfiles/local.zsh` or `~/.zshrc.local`.

## Worker & configurator architecture

The Worker is a separate thin consumer of the manifests, connected at build time via `gen_catalog.py`:

```text
manifest/*.json ── scripts/gen_catalog.py ── worker/public/catalog.json ── /api/catalog ── /config
```

- **Script proxying (`/`, `/install.sh`, `/install.ps1`)**: fetches `install.sh` / `install.ps1`
  from `raw.githubusercontent.com/RolinShmily/dotfiles/main` using a per-minute cache-busting
  bucket query parameter and returns `Cache-Control: no-store` so edge caches cannot pin stale
  bootstraps.
- **Archive relay (`/repo.tar.gz`, `/repo.zip`)**: streams `codeload.github.com` archives of `main`
  as a reliable fallback when GitHub is unreachable from the client machine.
- **Static configurator (`/config`, `/api/catalog`)**: served from Cloudflare Workers `assets`
  binding. `worker/public/app.js` only composes CLI flags (`--apps`, `--configs`, `--mirror`,
  `--mirror-*`, `--proxy`); all validation and execution stay in `scripts/main.py`.

## Boundaries

- **Manifests own data; the Python engine owns behavior.** Adding software or configs should require
  editing only `manifest/*.json`, `configs/`, and regenerating `catalog.json`.
- **The Worker never executes installs or duplicates package lists.** It only serves scripts,
  archives, and the generated catalog UI.
- **Bootstrap stays minimal.** `install.sh` / `install.ps1` only check Python and locate the repo;
  all flag parsing and install logic live in `scripts/`.

Design principles, precedence rules, and trade-offs are documented in [Design](design.md).
