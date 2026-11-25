# Design

This document captures the rules, conventions, and engineering trade-offs behind SrP-Dotfiles.
[Architecture](architecture.md) explains how the pieces fit together; this file explains *why* they
are shaped that way.

## Core principles

1. **Manifests are the API.** `manifest/<os>.json` is the single source of truth for packages, apps,
   fonts, and configs. Scripts must not hardcode OS-specific package lists.
2. **Select concrete apps, not abstract presets.** Selection is expressed directly as `pkg:`,
   `winget:`, `scoop:`, `font:`, `npm:`, and `skill:` IDs plus config names. Supporting
   infrastructure (Scoop setup, shell setup, backup creation) is derived automatically from what was
   selected.
3. **Mirrors are configuration.** Network sources live in `manifest/mirror.json` as named profiles
   plus optional per-field overrides. Empty values mean upstream defaults; system OS package managers
   (`pacman`, `apt`, `dnf`, `pkg`, `winget`) are never rewritten.
4. **The Worker is a thin client.** The web configurator and Worker select IDs and assemble CLI
   flags, but never run installs or maintain their own package lists. All validation stays in
   `scripts/main.py`.
5. **One engine, thin shims.** `install.sh` and `install.ps1` only check Python and locate/refresh
   the repository. Business logic lives in `scripts/`.
6. **Bootstrap must not depend on the repository.** `mirror.json` lives inside the repo, so initial
   fetching uses built-in GitHub mirror probing and Worker archive fallbacks before giving up.
7. **Steps are explicit and resilient.** Every step confirms interactively (unless `-y`), can be
   retried, skipped, or aborted, and appears in the final audit report. `--dry-run` shows the exact
   plan with zero side effects. Single unavailable or conflicting packages degrade to warnings
   instead of aborting the whole machine setup; only missing config sources or total step failures
   return non-zero.
8. **One deploy verb: copy.** Every config entry copies its source over the target after archiving
   the previous content to `~/.dotfiles_backup_*`. `ifMissing` is the only guard that skips an
   existing target. No symlinks and no per-app custom deploy scripts.
9. **Stable IDs.** App and config IDs form the contract between the CLI, manifests, and the Worker
   configurator. Renaming or removing an ID requires regenerating `worker/public/catalog.json` and
   updating any affected docs.

## Rolling `main` model

SrP-Dotfiles tracks `main` continuously without version tags, GitHub Releases, or a manual
changelog:

- Every runtime consumer — `dot.srprolin.com` (Cloudflare Worker), `install.sh` / `install.ps1`, and
  `.github/workflows/deploy.yml` — deploys and fetches directly from `main`.
- Dotfiles evolve via frequent small adjustments (package lists, aliases, tool configs, mirror
  endpoints) where semantic versioning has no downstream consumers.
- Commit history uses Conventional Commits (`feat`, `fix`, `chore`, `docs`) as the authoritative
  change record.

## Layout conventions

- `configs/` — repository files and directories copied onto the target machine.
- `scripts/lib/` — shared Python engine modules (standard library only).
- `manifest/` — per-OS manifests and `mirror.json`.
- `worker/` — Cloudflare Worker router, static configurator assets, and generated `catalog.json`.
- `docs/` — technical documentation (development, architecture, design, references).

## Precedence rules

- **Config selection**: `--configs` overrides the default (all configs in the OS manifest); `none`
  selects nothing.
- **App selection**: `--apps` overrides the default (all apps in the OS manifest); `none` selects
  nothing.
- **Mirrors & proxy**: `manifest/mirror.json` default `profile` → `--mirror <profile>` →
  `--mirror-<name> <value>` / `--proxy <url>`. Passing `none` clears a single field.

## Extension rules

- Adding or removing an app or config touches only `manifest/<os>.json` (and `configs/` if new) plus
  regenerating `worker/public/catalog.json`.
- Adding a new OS profile touches `manifest/<os>.json`, the `PROFILES` / OS detection code in
  `scripts/lib/platform_info.py` and `scripts/lib/catalog.py`, and any new package-manager branch in
  `scripts/lib/installers.py`.
- Adding or removing user-facing strings in `scripts/lib/messages.py` must keep
  `scripts/tests/test_messages.py` passing (no undefined or orphaned keys).

## Non-goals

- **Cross-package dependency solving**: left to the OS package manager (`pacman`, `apt`, `dnf`,
  `pkg`, `winget`, `scoop`). Manifest package order only determines survival order during
  per-package fallback retries.
- **Executing arbitrary commands from URL parameters**: the Worker and configurator accept only
  whitelisted catalog IDs and documented flags.
- **Storing personal mirror URLs or secrets in the Worker**: custom overrides remain local to
  `manifest/mirror.json` or CLI flags.
- **Cross-platform abstraction for its own sake**: platform-specific branches are encouraged inside
  `installers.py` when OS tooling genuinely differs (for example Windows `PATHEXT` shims, `winget`
  exit codes, or Termux single-font constraints).

## Side effects & persistence

Mirror settings apply to the install process environment and, for a few ecosystems (`pip`, `Go`,
`Scoop`), write user-level configuration so subsequent interactive installs remain fast. Nothing is
written to system-wide `/etc` paths, and `proxy` / `githubProxy` / `npmRegistry` never modify
persistent files.

| Setting | Mechanism | Persisted to disk |
| :--- | :--- | :--- |
| `proxy` | Process env (`ALL_PROXY`, `HTTP(S)_PROXY`, `npm_config_proxy`) | No |
| `githubProxy` | URL prefix constructed at download time | No |
| `npmRegistry` | Process env + per-call `--registry` flag (no `.npmrc` write) | No |
| `pypiIndex` (env) | `PIP_*` / `UV_*` env vars for the run | No |
| `pypiIndex` (config) | `~/.config/pip/pip.conf` or `%APPDATA%\pip\pip.ini` | **Yes** |
| `goProxy` | `go env -w GOPROXY` (`%APPDATA%\go\env`) when `go` is installed | **Yes** |
| `scoopBuckets` | `scoop bucket rm/add` | **Yes** |

**Asymmetry to be aware of**: persistence runs during any full install (without `-c`) whenever the
active profile sets a value — even if `--apps none` is passed. Switching to an empty profile later
does **not** revert previously written user configs; reset them explicitly when needed:

```bash
pip config unset global.index-url
go env -w GOPROXY=          # or remove $GOENV
scoop bucket rm <name>      # then re-add the upstream bucket
```

## Engineering trade-offs

- **Python 3.9+ requirement vs pure shell**: requires Python upfront on bare machines, but eliminates
  maintaining parallel Bash and PowerShell business logic and drops Node.js as a runtime dependency.
- **Copy-only deployment vs symlinks**: requires re-running `./install.sh -c` to push repo edits to
  `$HOME`, in exchange for deployed machines never breaking if the clone is moved, deleted, or
  edited, and eliminating Windows symlink privilege friction.
- **App-level IDs vs preset bundles**: produces longer CLI commands when selecting many items
  manually, but keeps the web configurator and CLI 100% transparent and honest.
- **Route-based Worker deployment vs `workers.dev`**: requires a Cloudflare zone and proxied DNS
  record (`dot.srprolin.com`), while giving a clean domain and avoiding public `workers.dev`
  exposure.
- **No root execution**: refusing `root`/`sudo` by default adds an env flag (`SRP_ALLOW_ROOT=1`) for
  Docker/CI use, while preventing accidental deployments into `/root` or root-owned files in `$HOME`.
