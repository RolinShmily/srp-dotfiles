# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- All application configs moved under `config/`.
- README and installation docs rewritten for the Python installer, mirror profiles and Worker.
- The zsh entrypoint now resolves the repository from `config/zsh/zshrc`.
- Manifests describe concrete apps; Windows fonts are exposed as apps.

### Removed

- `launch.sh`, `start.ps1`, the bash/PowerShell libraries and the Node-based manifest reader.
- The unit/preset abstraction; selection is now app/config based.

### Fixed

- GitHub font downloads work through the configured proxy.
- Windows font installation works without Scoop when a GitHub mirror or proxy is configured.
- Config deployment follows the new `config/` paths.

### Breaking

- Use `./install.sh` or `.\install.ps1` instead of `launch.sh` / `start.ps1`.
- Python 3.9+ is required; Node.js is no longer needed to read manifests.
