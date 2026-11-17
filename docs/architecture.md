# Architecture

SrP-Dotfiles is a declarative installer: JSON manifests describe what to install and deploy, and a
single Python engine executes it. There is no package list or platform branch hidden in the CLI.

## Layout

```text
.
├── install.sh / install.ps1     # thin launchers (check Python, locate repo)
├── scripts/
│   ├── main.py                  # CLI, menu, orchestration
│   ├── changelog.py             # CHANGELOG.md section extractor (release workflow)
│   ├── gen_catalog.py           # build worker/public/catalog.json
│   ├── lib/
│   │   ├── catalog.py           # apps, configs, mirror profile schema
│   │   ├── manifest.py          # manifest + mirror.json loading
│   │   ├── platform_info.py     # OS/paths/commands
│   │   ├── net.py               # mirrored downloads
│   │   ├── runner.py            # confirmation, retry/skip/abort, report
│   │   ├── deploy.py            # copy/backup verbs
│   │   ├── installers.py        # package managers, fonts, npm, uv, scoop
│   │   └── context.py           # context passed to deployers
│   ├── deployers/               # custom deployment modules (pi, windows-terminal)
│   └── tests/                   # offline tests
├── manifest/
│   ├── arch|debian|fedora|termux|windows.json
│   └── mirror.json              # proxy + named mirror profiles
├── configs/                     # application configs tracked by the repo
├── worker/                      # Cloudflare Worker + configurator
├── docs/                        # this directory
└── .github/workflows/           # CI, deploy, release
```

## Flow

```text
install.sh / install.ps1
        │  Python 3.9+ check, repo lookup/clone
        ▼
scripts/main.py
        │  parse flags, load manifest/<os>.json + mirror.json
        │  resolve --apps / --configs / --mirror-profile / --mirror-*
        ▼
scripts/lib/runner.py  ── per-step confirm, retry/skip/abort, audit report
        │
        ├── installers.py    pacman/apt/dnf/pkg, winget, scoop, fonts, npm, uv
        └── deploy.py        copy (plus deployers/*.py)
```

The Worker is a separate consumer of the same manifests:

```text
manifest/*.json ── gen_catalog.py ── worker/public/catalog.json ── /api/catalog ── /config
```

## Boundaries

- Manifests own data; the Python engine owns behavior.
- The Worker only serves scripts, catalog data and static assets.
- Deployers receive a `Context` and may touch the system; the core engine stays platform-neutral.

Design principles and conventions are documented in [Design](design.md).
