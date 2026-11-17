# Design

This document describes the rules the repository follows. Architecture describes structure;
this file describes intent and trade-offs.

## Principles

1. **Manifests are the API.** `manifest/<os>.json` is the only source of packages, apps, configs and
   Pi resources. Scripts must not contain OS-specific package lists.
2. **Select concrete apps, not presets.** Selection is expressed as `pkg:` / `winget:` / `scoop:` /
   `font:` / `npm:` / `skill:` IDs and config names. Infrastructure such as Scoop setup, shell setup
   and backups is derived from the selected apps.
3. **Mirrors are configuration.** Network sources live in `manifest/mirror.json` as profiles and
   optional overrides. Empty values mean upstream defaults; system package managers are untouched.
4. **The Worker is a client.** The page and Worker may select IDs and assemble flags, but never
   execute installs or duplicate package lists. Validation stays in `scripts/main.py`.
5. **One engine, thin shims.** `install.sh` / `install.ps1` only bootstrap Python and locate the
   repository. Business logic lives in `scripts/`.
6. **Bootstrap must not depend on the repository.** `mirror.json` lives inside the repo, so the
   fetch itself falls back across the Worker archive and GitHub proxies before giving up.
7. **Steps are explicit.** Every step confirms, can be retried/skipped/aborted, and is visible in the
   audit report. `--dry-run` prints the plan without side effects.
8. **Deploy verbs are limited.** `link`, `copy` and `custom` cover normal configs; anything else is a
   deployer module. Copy is destructive by design; `ifMissing` is the explicit exception.
9. **Stable IDs.** App and config IDs are part of the public CLI/Worker contract; renaming requires a
   changelog note and catalog regeneration.

## Layout conventions

- `configs/` — repository content deployed to the machine.
- `scripts/lib/` — shared engine modules.
- `scripts/deployers/` — custom deployment modules (`run(ctx)`).
- `manifest/` — OS manifests and mirror profiles.
- `worker/` — static assets, routing and the generated catalog.

## Precedence rules

- Config selection: `--configs` > all.
- Apps: `--apps` > all.
- Mirrors: file profile → `--mirror-profile` → `--mirror-*` / `--proxy`.

## Extension rules

- Adding an app or config changes only a manifest; regenerate `worker/public/catalog.json`.
- Adding a custom deployer adds `scripts/deployers/<name>.py` and a `custom` manifest entry.
- Adding an OS profile touches `manifest/<os>.json`, `PROFILES` lists and any new package-manager
  branch.
- Any behavior change gets a `CHANGELOG.md` entry; tags drive releases.

## Non-goals

- Dependency solving between apps; the OS package manager does that.
- Arbitrary commands from URL parameters; only whitelisted IDs are accepted.
- Storing user mirror URLs or secrets in the Worker; they remain local to `manifest/mirror.json`.
- Cross-platform abstraction for its own sake; platform-specific logic is allowed in
  `installers.py` and deployers when the behavior genuinely differs.

## Side effects

Mirror selection changes the process environment for the run and, for pip / Go / Scoop, writes
user-level configuration so repeated installs stay fast. Nothing is written to system-wide paths, and
`proxy` / `githubProxy` / `npmRegistry` never touch persistent files. The trade-off is asymmetry:
`install` persists pip and Go settings even when no apps are selected, and an emptied profile does not
revert them — documented in [References](references.md#mirror-schema).

## Trade-offs

- The Python requirement breaks very minimal Unix installs, but removes the Node dependency for
  reading manifests and enables a single cross-platform engine.
- App-level selection produces longer commands than unit presets, but keeps the UI and CLI honest.
- Route-based Worker deployment requires an existing Cloudflare zone and proxied DNS record, while
  removing workers.dev exposure.
