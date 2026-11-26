# References

Complete CLI flags, ID grammar, manifest/mirror/catalog schemas, font specs, Worker routes,
bootstrap behavior, and CI/CD operational contracts.

## CLI

```bash
./install.sh [-c] [-y] [--os NAME] [--dry-run]
             [--apps IDS] [--configs NAMES] [--mirror NAME]
             [--mirror-NAME VALUE] [--proxy URL] [--catalog]
```

| Flag | Notes |
| :--- | :--- |
| `-c, --config` | Deploy configs only; skip package/font/mirror-persistence steps |
| `-y, --yes` | Approve all steps automatically; required when stdin is not a TTY |
| `--os` | Override auto-detection: `arch` / `debian` / `fedora` / `termux` / `windows` |
| `--dry-run` | Print the execution plan without side effects |
| `--apps` | Comma-separated app IDs, or `none` to skip all apps |
| `--configs` | Comma-separated config names, or `none` to skip all configs |
| `--mirror` | Select a profile key from `manifest/mirror.json` (`global`, `cn`) |
| `--mirror-<name>` | Override a single field (`github`, `npm`, `pypi`, `go`, `scoop`); `none` clears it |
| `--proxy` | `host:port` (scheme auto-probed) or explicit proxy URL; `none` clears it |
| `--catalog` | Print the resolved OS catalog as JSON and exit |

List flags (`--apps`, `--configs`, `--mirror-*`) accept comma-separated values. Because PowerShell
parses an unquoted `a,b` as an array, the configurator always quotes list values
(`--apps "a,b"`), and the CLI accepts both comma-separated and space-separated forms for hand-typed
commands.

## App and config IDs

| ID pattern | Manifest source |
| :--- | :--- |
| `pkg:<name>` | Unix `packages` |
| `winget:<id>` | Windows `wingetPackages` |
| `scoop:<name>` | Windows `scoopPackages` |
| `font:<name>` | `fonts` (all platforms) |
| `npm:<name>` | `npmGlobals` |
| `skill:<item>` | `skillsAdd` |
| `<name>` | Config entry `name` (`--configs` only) |

## Manifest schema

Located in `manifest/<os>.json` (`arch`, `debian`, `fedora`, `termux`, `windows`).

| Key | Type | Platform |
| :--- | :--- | :--- |
| `packageManager` | string | Unix: `pacman` / `apt` / `dnf` / `pkg` |
| `packages` | string[] | Unix |
| `copr` | string[] | Fedora |
| `fonts` | string[] | All |
| `npmGlobals` | string[] | All |
| `skillsAdd` | string[] | All |
| `configs` | object[] | All |
| `wingetPackages` | string[] | Windows |
| `scoopPackages` | string[] | Windows |

### Package order

Unix `packages` arrays are ordered dependency-first because failed batch installs fall back entry by
entry in manifest order (per-package retry for `apt`/`pacman`/`pkg`, `--skip-broken` for `dnf`):

1. Base toolchain and network primitives: `git`, `curl`, `unzip`, `file`, `base-devel`/`clang`/`make`.
2. Shell and plugins: `zsh`, then `zsh-autosuggestions` and `zsh-syntax-highlighting`.
3. Runtimes and package managers: `python3`, `python3-pip` before `pipx`, `nodejs` before `npm`, `uv`.
4. CLI tools: `ripgrep`, `fd`, `bat`, `eza`, `zoxide`, `fzf`, `jq`, `gh`, `lazygit`, …
5. Media and archive tools: `ImageMagick`, `poppler`, `ffmpeg`, `sox`, `chafa`, `mediainfo`,
   `7zip`, `unar`, `exiftool`.
6. Applications (providers before consumers): `zathura` before `zathura-pdf-poppler`, `yazi`, `vim`,
   `tmux`, `fastfetch`, `btop`, clipboard tools.

OS package managers still resolve dependencies themselves; the ordering ensures providers succeed
before consumers when an unrelated package in the batch is unavailable or conflicts with an
installed replacement.

### Config entry

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `name` | yes | Stable config ID exposed to `--configs` and `/config` |
| `source` | yes | Repository-relative file or directory path, normally `configs/...` |
| `target` / `targets` | yes | One destination path or a list of destination paths |
| `exclude` | no | Top-level entry names inside a source directory to skip |
| `ifMissing` | no | When `true`, skip deployment if the target already exists |
| `when` | no | Path guard; skip deployment when this path does not exist |

Path placeholders expanded at runtime: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.

## Mirror schema

Defined in `manifest/mirror.json`:

```json
{
  "proxy": "",
  "profile": "global",
  "profiles": {
    "global": {
      "scoopBuckets": [
        "extras = https://github.com/ScoopInstaller/Extras",
        "nerd-fonts = https://github.com/matthewjberger/scoop-nerd-fonts"
      ]
    },
    "cn": {
      "githubProxy": [
        "https://gh-proxy.com/",
        "https://gh-proxy.org/",
        "https://proxy.269601.xyz/"
      ],
      "npmRegistry": "https://registry.npmmirror.com",
      "pypiIndex": [
        "https://pypi.tuna.tsinghua.edu.cn/simple",
        "https://mirrors.ustc.edu.cn/pypi/simple"
      ],
      "goProxy": "https://goproxy.cn,direct",
      "scoopBuckets": [
        "main = https://mirror.nju.edu.cn/git/scoop-main.git",
        "extras = https://mirror.nju.edu.cn/git/scoop-extras.git",
        "versions = https://mirror.nju.edu.cn/git/scoop-versions.git",
        "nerd-fonts = https://mirror.nju.edu.cn/git/scoop-nerd-fonts.git/",
        "dorado = https://github.com/chawyehsu/dorado"
      ]
    }
  }
}
```

| Field | Type | Applies to |
| :--- | :--- | :--- |
| `githubProxy` | string[] | GitHub releases, raw scripts, `git clone`, GitHub Scoop buckets; tried in order with direct GitHub retained as final fallback |
| `npmRegistry` | string | `npm` / `npx` (`npm_config_registry` + `--registry`) |
| `pypiIndex` | string or string[] | `pip` and `uv` (first entry = primary index, remaining = extra indexes) |
| `goProxy` | string | `GOPROXY` (supports Go syntax such as `...,direct`) |
| `scoopBuckets` | string[] or object | Scoop buckets on Windows (`name = url`) |

- **Precedence**: `manifest/mirror.json` default `profile` → `--mirror` → `--mirror-*` / `--proxy`.
- **Proxy handling**: top-level `proxy` (or `--proxy`) applies across downloads independent of the
  selected profile. When passed as `host:port`, the installer probes the port once and selects
  `socks5://` if it answers a SOCKS5 greeting, otherwise `http://`. Explicit schemes (`http://`,
  `https://`, `socks5h://`, …) are kept verbatim. Because `npm` and `winget` do not support SOCKS,
  an `http://` mixed port is the safest choice.
- **Scoop note**: Scoop does not support path-prefix mirrors; when `githubProxy` or `proxy` is set,
  Windows downloads Maple fonts directly instead of through Scoop.

Environment variables exported during installation:

```text
ALL_PROXY, HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy, npm_config_proxy
PIP_INDEX_URL, PIP_EXTRA_INDEX_URL
UV_INDEX_URL, UV_DEFAULT_INDEX, UV_EXTRA_INDEX_URL
GOPROXY
npm_config_registry
```

See [Design](design.md#side-effects--persistence) for which mirror settings persist to disk and how
to revert them.

## Deployment durability

- Configs are copied into place; existing files or directories are moved to `~/.dotfiles_backup_*`
  before replacement.
- Legacy symlinks and hard-linked targets are unlinked first so deployed files never share inodes
  with the repository.
- A missing `source` fails the step and causes the installer to exit non-zero.
- On Unix, the zsh module tree (`env`, `omz`, `git`, `aliases`, `tools`, `os/`) is copied to
  `~/.config/srp-dotfiles/zsh`, so `~/.zshrc` continues working if the repository clone is moved or
  deleted. Selecting `zshrc` deploys `zsh-modules` automatically.
- `~/.zshrc` resolves its module tree in order: `~/.config/srp-dotfiles/zsh`, `ZSH_DOTFILES_DIR`,
  a symlinked `~/.zshrc`, `~/.srp-dotfiles`, `~/.dotfiles`, and `~/Projects/dotfiles`.
- `~/.config/srp-dotfiles/zsh` is fully managed and replaced on every deploy; put machine-local
  overrides in `~/.config/srp-dotfiles/local.zsh` or `~/.zshrc.local`.

## Login shell & root guard

- The installer refuses to start as `root` or under `sudo` (unless `SRP_ALLOW_ROOT=1` for containers
  and CI) so configs are never deployed into `/root` or written with root ownership in `$HOME`.
- The login-shell step appends `zsh` to `/etc/shells` when missing, targets `SUDO_USER` if invoked
  through sudo, compares real paths (`/bin/zsh` vs `/usr/bin/zsh`), and prints the exact `chsh`
  command if the change is refused.

Manual fallback:

```sh
sudo chsh -s "$(command -v zsh)" "$USER"
getent passwd "$USER" | cut -d: -f7
```

## Fonts

| ID | Source | License | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `MapleMono-NF-CN` | `subframe7536/maple-font` latest release | SIL OFL 1.1 | Unix, Windows, Termux | Terminal font; Scoop fallback on Windows |
| `Inter` | `rsms/inter` v4.1 | SIL OFL 1.1 | Unix, Windows | Latin UI font; direct GitHub download |
| `SourceHanSansSC` | `adobe-fonts/source-han-sans` 2.005R (SC OTF) | SIL OFL 1.1 | Unix, Windows | CJK UI font (~95 MB download) |

Termux installs only `MapleMono-NF-CN` because it supports a single `~/.termux/font.ttf`. Font
downloads respect `githubProxy` and `proxy`; individual download failures are reported as warnings
and do not abort the run.

## Worker

Deployed on route `dot.srprolin.com/*` via `worker/wrangler.toml`.

### Routes

| Path | Response | Caching |
| :--- | :--- | :--- |
| `/` | `install.ps1` for Windows/PowerShell UA, `install.sh` otherwise (`?os=windows` / `?os=unix` overrides) | `no-store` (60s upstream bucket) |
| `/install.sh`, `/install.ps1` | Explicit bootstrap script | `no-store` (60s upstream bucket) |
| `/config` | Static HTML configurator (`worker/public/config.html`) | `max-age=300` |
| `/api/catalog` | Static catalog JSON (`worker/public/catalog.json`) | `max-age=300` |
| `/repo.tar.gz`, `/repo.zip` | Upstream `main` repository archive from `codeload.github.com` | `max-age=300` |
| `/health` | Plain text `ok` | `max-age=300` |

### Catalog JSON (schema 8)

Generated by `scripts/gen_catalog.py` into `worker/public/catalog.json` (same per-OS schema as
`scripts/main.py --catalog`):

```json
{
  "schema": 8,
  "catalogs": {
    "arch": {
      "apps": [{ "id": "pkg:zsh", "source": "pacman", "name": "zsh", "label": "zsh" }],
      "configs": [{ "id": "zshrc", "label": "zshrc" }],
      "mirrors": {
        "default": "global",
        "proxy": "",
        "fields": [{ "id": "github", "label": "GitHub proxy", "type": "list" }],
        "profiles": { "global": {}, "cn": {} }
      }
    }
  }
}
```

`python scripts/gen_catalog.py --check` fails whenever `worker/public/catalog.json` is out of date.

## Bootstrap

`install.sh` / `install.ps1` fetch the repository before `mirror.json` is available:

1. `git clone --depth=1` from `SRP_REPO_URL` when set; otherwise GitHub via `SRP_GH_PROXY`, built-in
   prefixes (`gh-proxy.com`, `gh-proxy.org`, `proxy.269601.xyz`), then direct GitHub. Each mirror
   prefix is probed briefly before cloning.
2. When `git` is unavailable or every clone fails: download an archive from `<origin>/repo.tar.gz`
   (or `/repo.zip` on Windows), then `SRP_REPO_TARBALL`, then GitHub `codeload` (direct and through
   the same prefixes).
3. If every candidate fails, exit `1` and print manual retry commands.

### Environment variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SRP_REPO_URL` | GitHub HTTPS URL | Override the Git clone URL |
| `SRP_GH_PROXY` | *(empty)* | Extra GitHub proxy prefix tried before the built-in list |
| `SRP_REPO_TARBALL` | *(empty)* | Explicit repository archive URL |
| `SRP_REPO_REF` | `main` | Branch or ref to fetch |
| `SRP_DOTFILES_DIR` | `~/.srp-dotfiles` | Explicit checkout directory (`explicit` mode) |
| `SRP_INSTALL_ORIGIN` | `https://dot.srprolin.com` | Worker base URL for archive fallback |
| `SRP_ALLOW_ROOT` | *(unset)* | Set to `1` to bypass the root guard (containers/CI only) |
| `PYTHON` | `python3` | Python interpreter override for `install.sh` |

## CI/CD

| Workflow | Trigger | Result |
| :--- | :--- | :--- |
| `.github/workflows/test.yml` | Push to `main`, pull requests | Python 3.9/3.12 compile & unit tests, catalog check, CLI dry-runs, `sh -n` & PowerShell parse check, Worker syntax & route tests |
| `.github/workflows/deploy.yml` | Push to `main` touching `worker/**`, `scripts/**`, `manifest/**`, or `deploy.yml`; manual dispatch | Catalog check, Worker tests, Wrangler 4 deploy, post-deploy smoke test (`/health`, `/config`, `/api/catalog`) |

Required secrets: `CLOUDFLARE_API_TOKEN` (`Workers Scripts:Edit`, `Workers Routes:Edit`, `Zone:Read`
for `srprolin.com`), `CLOUDFLARE_ACCOUNT_ID`.

## Local verification commands

```bash
python -m compileall -q scripts
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
node --check worker/index.js
node --check worker/public/app.js
node worker/test.mjs
sh -n install.sh
```
