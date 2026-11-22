# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The `install.sh` and `install.ps1` headers now follow a Docker-style layout: summary,
  requirements, usage, command-line options, environment, bootstrap order and Worker routes. The
  documented flags and environment variables match the CLI.

### Fixed

- `winget install` exits with `UPDATE_NOT_APPLICABLE` (`0x8A15002B` = `2316632107`) when a package
  is already installed and no newer version is offered. That benign result was reported as a failed
  step on every run; it now logs the package as already up to date and continues.
- Windows Scoop steps failed one by one with `scoop: command not found` when Scoop was missing or
  the setup step was skipped. The shims directory is now added to `PATH` after setup, and the
  remaining Scoop steps are skipped with a single warning; fonts fall back to a direct download and
  `uv` is skipped when it is absent.
- Windows: commands that exist only as `.cmd` shims (`scoop`, `npm`, `npx`) failed with
  `<name>: command not found` even though `shutil.which` found them, because `CreateProcess` only
  appends `.exe`. Bare names are now resolved through `PATHEXT` before execution.

## [1.1.1] - 2026-11-22

### Added

- `zsh-modules` config entry (all Unix manifests): the zsh module tree is copied to
  `~/.config/srp-dotfiles/zsh`, so a copied `~/.zshrc` no longer depends on the repository clone.
  Selecting `zshrc` deploys it automatically.

### Changed

- The `global` mirror profile now declares the `extras` and `nerd-fonts` Scoop buckets, so the
  Windows app list (`vscode`, `notepad3`, and the Maple Mono NF CN font) resolves without the `cn`
  profile.
- Windows: the Maple font moved from `scoopPackages` to `fonts`, and the catalog special case is
  gone. It was already installed once through the font path, so behavior is unchanged.
- The `cn` mirror profile now uses `gh-proxy.com`, `gh-proxy.org` and `proxy.269601.xyz`;
  `ghfast.top` is gone from the profile, the bootstrap prefixes and the docs.
- The bootstrap keeps the unproxied GitHub URL as a fallback instead of stopping at the last
  mirror, validates downloaded archives, clones through every prefix, and refreshes a cached
  checkout by URL, repointing its origin at GitHub.
- The bootstrap refreshes the auto-managed `~/.srp-dotfiles` on every run instead of reusing any
  checkout that contains `scripts/main.py`, prints the revision it runs, and probes mirrors before
  cloning so a dead proxy does not stall for minutes.

### Fixed

- `~/.zshrc` deployed by copy resolved `DOTFILES_CONFIG` with the symlink rules (falling back to
  `/`), so `env`, `omz`, `aliases` and the other modules were skipped silently: no theme, no
  syntax highlighting and no aliases. It now prefers the deployed modules, then
  `~/.srp-dotfiles`, symlinks and direct sourcing.
- Without Oh My Zsh, `omz.zsh` sources the distro `zsh-autosuggestions` and
  `zsh-syntax-highlighting` scripts as a fallback, and the plugin step warns instead of returning
  silently.
- `apt` aborted the whole batch when one package name was unavailable, leaving even `zsh`
  uninstalled; packages are now retried individually and the failures are reported.
- `apt` now probes the archive before installing and skips packages this release does not ship
  (e.g. `eza`, `fastfetch`, `lazygit` on Debian 12) with a warning instead of failing the step.
- The installer refuses to run as root or through `sudo` (`SRP_ALLOW_ROOT=1` is reserved for
  containers/CI), because it deploys into `$HOME`; the recommended URLs now point at
  `https://dot.srprolin.com`, and both bootstrap headers document the Worker routes.
- The shell step used `USER`, which sudo sets to `root`, so the login shell of the calling account
  was left alone; it now prefers `SUDO_USER`, compares real paths and reports the result.
- `profile.ps1` overwrote the absolute `SHELL` / `ZELLIJ_SHELL` set by the installer with a bare
  `pwsh.exe`, which ssh resolves against the current directory; it now stores `pwsh`'s full path.
- Legacy link deployments left directory links under `~/.config`; `rmdir()` on those raised
  `ENOTDIR`, so copy deployment failed until the links were removed by hand. Links are now
  unlinked first, and target directories are created without resolving through a dangling
  `~/.config`.
- The Termux manifest listed `imagemagick` twice.
- `pkg` (Termux) retries package by package when a batch fails, like `apt`, so one unavailable
  name no longer aborts the whole list.
- Fedora enabled the `dejan/lazygit` COPR although `lazygit` is in the official repositories; the
  extra step could fail on systems without the copr plugin.
- Debian deployed `btop.conf` without the theme directory it references
  (`catppuccin_mocha.theme`); both are now deployed together.
- The Worker served a five-minute-cached bootstrap, so a pre-release script could survive a push;
  it now fetches through a per-minute cache key, keeps script responses out of the cache, and
  marks them `no-store`.
- `mirror.status` was pruned with the unused message keys, so the mirror summary printed the raw
  key; it is restored, and a test now fails on any used-but-undefined or defined-but-unused key.
- Aliases for optional tools (`ff`, `serve`, `lg`) are only registered when the command exists.
- PowerShell `ssh-copy-id` no longer advertises `-i` / `-p`: PowerShell parameter binding rejected
  them before the function ran. It now takes `[user@]hostname` and uses the first `~/.ssh/*.pub`.

## [1.1.0] - 2026-11-18

### Added

- Mirror-aware bootstrap: `install.sh` / `install.ps1` try `git clone` (via `SRP_REPO_URL`, then
  `SRP_GH_PROXY`, `ghfast.top`, `gh-proxy.com`, then direct) and fall back to a repository archive
  (`<origin>/repo.tar.gz`, `SRP_REPO_TARBALL`, codeload). `SRP_REPO_REF` and `SRP_INSTALL_ORIGIN`
  are also honoured.
- Worker routes `/repo.tar.gz` and `/repo.zip`, so the repository can still be fetched when git and
  GitHub are unreachable.
- `proxy` accepts `host:port`: the installer probes the port once and adds `socks5://` or `http://`;
  an explicit scheme is kept verbatim.

### Changed

- Only `-c / --config` remains. Running the installer without it installs dependencies and deploys
  configs; `-a / --all` and `-i / --install` were removed.
- Config deployment is copy-only: every entry copies its source over the target, archiving the
  previous content to `~/.dotfiles_backup_*`. `link`, `.example` templates and `-f / --force` are
  gone, and `--copy`/`SRP_DEPLOY_METHOD` were dropped along with `link`.
- Manifests no longer have a `method` field, custom deployers (`scripts/deployers/`) or
  `piResources`: `~/.pi/agent` is a plain directory copy and Pi discovers `skills/` itself.
- `i18n.py` became a single-language `messages.py`; `--lang`, `-Lang`, `DF_LANG`/`SRP_LANG` and the
  interactive menu were removed.
- `--mirror-profile` became `--mirror`; per-field overrides stay `--mirror-<name>`.
- A missing config source fails the step instead of being skipped, and the installer exits non-zero
  when a step failed.
- Bootstrap scripts were simplified: `install.sh` rewritten without temp files, both headers trimmed.
- CI also parses `install.ps1` and runs a config-only smoke test.

### Fixed

- `scoop.missing` was referenced but never defined, so a failed Scoop install printed the key name.
- The worker repository-archive error response contained a stray newline, and CI now parses
  `install.ps1` as well.
- Docs still advertised catalog schema 7 and the removed `pythonManager` manifest key.

### Documented

- Which mirror settings persist (pip config, `go env`, Scoop buckets) versus which are
  process-scoped, and how to revert them.

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
