# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Mirror-aware bootstrap: `install.sh` / `install.ps1` fall back from `git clone` to the Worker
  repository archive, `ghfast.top` / `gh-proxy.com`, then direct GitHub, with `SRP_REPO_URL`,
  `SRP_GH_PROXY`, `SRP_REPO_TARBALL`, `SRP_REPO_REF` and `SRP_INSTALL_ORIGIN` overrides.
- Worker routes `/repo.tar.gz` and `/repo.zip` so the repository can be fetched when git and GitHub
  are both unreachable.
- `--copy` (or `SRP_DEPLOY_METHOD=copy`) materialises `link` entries, producing a deployment that
  does not depend on the clone.

### Changed

- Config deployment is copy-only: `link` was removed because a symlink breaks as soon as the clone
  disappears. Existing targets are archived to `~/.dotfiles_backup_*` before being replaced.
- A missing config source now fails the step instead of being skipped silently, and the installer
  exits non-zero when anything failed.

### Breaking

- The `method` field is gone: every `configs` entry is a copy with backup. The `custom` deployers
  (`scripts/deployers/`), `piResources` and the `.example` templates were removed; `~/.pi/agent` is
  a plain directory copy relying on Pi's own `skills/` discovery, and Windows Terminal settings are
  replaced wholesale (the previous file, including `defaultProfile` / `profiles.list`, is archived).
- `method: "link"` is gone; use `method: "copy"`. `--copy` and `SRP_DEPLOY_METHOD` were removed since
  copy is now the only method.
- `-f / --force` was removed: copy always archives the previous target, so the flag had no purpose.
- `.example` templates are gone. `configs/pi/{settings,mcp,keybindings}.json`,
  `configs/code/settings.json` and `configs/windows-terminal/settings.json` are deployed like any
  other config: the previous target is archived to `~/.dotfiles_backup_*` before being replaced.

### Documented

- Spell out which mirror settings persist (pip config, `go env`, Scoop buckets) versus which are
  process-scoped (`proxy`, `githubProxy`, `npmRegistry`), and how to revert them.

## [1.0.4] - 2026-11-17

### Changed

- `install.ps1` and the READMEs now explain how to get `winget` (Microsoft Store link for App
  Installer) and list winget-free ways to install Python. A missing Python now prints the
  environment-appropriate options instead of always pointing at winget.

### Fixed

- List flags broke on Windows: PowerShell splits an unquoted `--apps a,b` into an array, so only the
  first ID was honoured. The configurator now quotes list values, and the CLI accepts both
  comma-separated and space-separated forms.

## [1.0.3] - 2026-11-17

### Fixed

- Windows PowerShell 5.1 blocked `install.ps1` under the default `Restricted` policy. The
  configurator now prefixes `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`, and
  the docs use the same form for local runs.
- The Windows execution-policy step warns instead of failing when the policy is pinned by a group
  policy or `Set-ExecutionPolicy` is unavailable.

## [1.0.2] - 2026-11-17

### Added

- `docs/` guides: development, architecture, design and references.
- Bilingual language links at the top of both README files.
- Inter and Source Han Sans SC fonts, registered through a shared font registry.

### Changed

- Repository layout: application configs moved from `config/` to `configs/`.
- Custom deployment modules moved from `scripts/configs/` to `scripts/deployers/`.
- Configurator mirror fields are spaced out for readability, and the "Go GOPROXY" label is now "Go proxy".

## [1.0.1] - 2026-11-17

### Fixed

- CI: run the Python 3.9 job on `ubuntu-22.04`, since `ubuntu-latest` no longer ships that toolchain.
- Worker deployment: pin Wrangler 4 so the `assets` binding is uploaded instead of only `index.js`.
- Worker deployment: smoke-test `/health`, `/config` and `/api/catalog` after every deploy.

## [1.0.0] - 2026-11-17

### Added

- Unified Python installer: `install.sh` / `install.ps1` hand over to `scripts/main.py`.
- Declarative app and config selection with `--apps`, `--configs` and `--catalog`.
- Mirror profiles (`global`, `cn`) with `--mirror-profile`, per-field `--mirror-*` overrides and `--proxy`.
- PyPI mirror shared by pip and uv; the `cn` profile includes TUNA and USTC indexes.
- Cloudflare Worker at <https://dot.srprolin.com>: OS-aware install scripts, `/config` configurator and `/api/catalog`.
- Catalog generation from manifests via `scripts/gen_catalog.py`.
- GitHub Actions CI, route-based Worker deployment and post-deploy smoke tests.
- Tests for catalog selection and Worker routes/configurator command generation.

### Changed

- All application configs moved under `configs/`.
- README and installation docs rewritten for the Python installer, mirror profiles and Worker.
- The zsh entrypoint now resolves the repository from `configs/zsh/zshrc`.
- Manifests describe concrete apps; Windows fonts are exposed as apps.

### Removed

- `launch.sh`, `start.ps1`, the bash/PowerShell libraries and the Node-based manifest reader.
- The unit/preset abstraction; selection is now app/config based.

### Fixed

- GitHub font downloads work through the configured proxy.
- Windows font installation works without Scoop when a GitHub mirror or proxy is configured.
- Config deployment follows the new `configs/` paths.

### Breaking

- Use `./install.sh` or `.\install.ps1` instead of `launch.sh` / `start.ps1`.
- Python 3.9+ is required; Node.js is no longer needed to read manifests.
