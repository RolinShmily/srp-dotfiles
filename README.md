# SrP-Dotfiles

**[English](README.md)** | [简体中文](README_zh.md)

Declarative cross-platform dotfiles. One Python entry installs dependencies and deploys configs on
Arch / Debian / Fedora / Termux / Windows.

## Requirements

Python **3.9+** is the only hard requirement for the installer itself:

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

On Windows, `winget` comes from App Installer. It is absent on LTSC images, Windows Sandbox and
Server; install it from the Microsoft Store:

```text
https://apps.microsoft.com/detail/9NBLGGH4NNS1
```

Without the Store, use the `winget-cli` releases, or skip winget entirely with
[python.org](https://www.python.org/downloads/windows/), `scoop install python`, or uv:

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"; uv python install 3.12
```

`install.sh` / `install.ps1` only check Python and start `scripts/main.py`; if Python is missing they
print these options and exit.

## Quick start

Online (clones the repo to `~/.srp-dotfiles` when needed):

```bash
curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -y
```

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

Local:

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/Projects/srp-dotfiles
cd ~/Projects/srp-dotfiles

./install.sh                  # prompts, installs and deploys everything
./install.sh -y               # same, no prompts
./install.sh -c               # configs only
./install.sh --os arch        # pick a target explicitly
./install.sh --dry-run -y     # print the plan only
```

```powershell
# Windows PowerShell 5.1 defaults to Restricted; relax it for this session:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1              # prompts, installs and deploys everything
.\install.ps1 -y           # same, no prompts
.\install.ps1 -c           # configs only
```

`install` also sets `RemoteSigned` for the current user, so later sessions can run
`.\install.ps1` without the `Set-ExecutionPolicy` line.

Every step is confirmed individually (core / optional label shown). `-y` approves everything and is
required when stdin is not a TTY. Steps whose dependencies are missing (npm, skills, brew-like tools)
are skipped with a warning instead of failing the run.

If GitHub is unreachable, the bootstrap falls back to the Worker tarball, then `ghfast.top` /
`gh-proxy.com`, then direct. Override with `SRP_GH_PROXY`, `SRP_REPO_URL` or `SRP_REPO_TARBALL`.

Configs are deployed by **copy**, so the machine does not depend on the clone afterwards. Existing
targets are archived to `~/.dotfiles_backup_*` before being replaced.
A missing source fails the step and the installer exits non-zero.

## Selective install

`--catalog` prints the concrete apps, configs and mirror profiles as JSON:

```bash
./install.sh --catalog --os arch
```

Pick apps and configs explicitly; mirrors have their own profile/override flags:

```bash
./install.sh -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror cn
```

- App IDs: `pkg:<name>` (Unix), `winget:<id>`, `scoop:<name>`, `font:<name>`, `npm:<name>`, `skill:<item>`.
- Config IDs are the `name` fields from `manifest/<os>.json`.
- Mirrors: `--mirror cn` picks a preset; `--mirror-<name> <value>` overrides one field
  (`github`, `npm`, `pypi`, `go`, `scoop`); `--proxy <url>` overrides the proxy. `none` clears.
- Omit a flag to select everything; pass `none` to select nothing.

## Documentation

Full guides live in [docs/](docs/README.md): development, architecture, design and reference schemas.

## Layout

```text
.
├── install.sh / install.ps1     # minimal launchers: check Python -> scripts/main.py
├── scripts/
│   ├── main.py                  # CLI and orchestration
│   ├── lib/                     # manifest, mirrors, net, runner, deploy, installers
├── manifest/
│   ├── arch|debian|fedora|termux|windows.json
│   └── mirror.json              # mirrors & proxy
├── configs/                     # application configs
│   └── zsh/ vim/ tmux/ powershell/ pi/ wezterm/ windows-terminal/ zellij/ yazi/ btop/ fastfetch/ code/
├── worker/                      # optional Cloudflare Worker install endpoint
└── docs/                        # development, architecture, design, references
```

## Install endpoint (optional)

`worker/` is a Cloudflare Worker plus a static configurator page, deployed as a Workers route on
`dot.srprolin.com/*` (requires a proxied DNS record for `dot` in the `srprolin.com` zone):

| Route | Purpose |
| :--- | :--- |
| `/` | `install.ps1` for Windows / PowerShell clients, `install.sh` otherwise |
| `/install.sh`, `/install.ps1` | explicit scripts (`?os=windows` / `?os=unix` forces a target) |
| `/config` | checkbox configurator that generates the install command |
| `/api/catalog` | app/config/mirror catalog consumed by the page (same schema as `--catalog`) |
| `/repo.tar.gz`, `/repo.zip` | repository archive (bootstrap fallback) |
| `/health` | health probe |

```bash
python scripts/gen_catalog.py     # refresh worker/public/catalog.json from manifests
cd worker
npx wrangler@4 deploy
```

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -y
```

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

The page is a thin client: it builds `--apps/--configs/--mirror-*` and nothing else; installation
and validation stay in `scripts/main.py`. The Mirrors section has a profile dropdown plus editable
fields: switching profiles adds `--mirror`, editing a field adds `--mirror-<name>`, and
unchanged values stay in `manifest/mirror.json` on the target machine. The scripts fetched by the
Worker still clone the repo locally; set `SRP_REPO_URL` when using a Git mirror.

## CI & deployment

Two GitHub Actions workflows live in `.github/workflows/`:

- `ci.yml` — Python 3.9/3.12 compile + unit tests + catalog check + CLI dry-runs, plus Worker syntax
  and route tests.
- `deploy.yml` — on pushes to `main` touching `worker/**`, `scripts/**` or `manifest/**` (or manual
  dispatch): validates the catalog, runs the Worker tests, then deploys with
  `cloudflare/wrangler-action`.
- `release.yml` — on `v*` tag pushes (or manual dispatch with an existing tag): extracts the matching
  section from [CHANGELOG.md](CHANGELOG.md) and creates or updates the GitHub release.

Add repository secrets before deploying:

| Secret | Purpose |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts:Edit, Workers Routes:Edit, and Zone:Read for `srprolin.com` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

Local equivalents:

```bash
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
node worker/test.mjs
```

Run `python scripts/gen_catalog.py` after changing the manifests, otherwise CI/deploy fails the catalog check.


## Mirrors & proxy

`manifest/mirror.json` has a top-level `proxy` plus named profiles:

```json
{
  "profile": "global",
  "profiles": {
    "global": {},
    "cn": { "githubProxy": ["..."], "npmRegistry": "..." }
  }
}
```

- `global` is the default and empty, i.e. system/upstream defaults.
- `cn` ships with GitHub / npm / pip / Go / Scoop presets.
- Pick one with `--mirror cn`; `profile` in the file sets the default.
- Override single fields with `--mirror-<name>` (`github`, `npm`, `pypi`, `go`, `scoop`) or
  `--proxy <url>`. Lists are comma separated; `none` clears a field.

| Field | Type | Applies to |
| :--- | :--- | :--- |
| `githubProxy` | array | GitHub releases, raw scripts, `git clone`, GitHub Scoop buckets; tried in order |
| `npmRegistry` | string | `npm` / `npx` |
| `pypiIndex` | string or array | pip / uv index (first = index, remaining entries become extra) |
| `goProxy` | string | `GOPROXY`, including CLI syntax such as `...,direct` |
| `scoopBuckets` | array or object | Scoop buckets (Windows) |

Top-level `proxy` applies to all downloads (`socks5://` or `http(s)://`) and is not a profile.
System package managers (`pacman` / `apt` / `dnf` / `pkg` / `winget`) are never overridden.
Scoop cannot use path-prefix mirrors; with a GitHub proxy or `proxy`, the Maple font is downloaded
directly instead of through Scoop.

### What gets written to disk

| Setting | Effect | Persisted |
| :--- | :--- | :--- |
| `proxy` | process env only | no |
| `githubProxy` | URL prefix at download time | no |
| `npmRegistry` | process env + per-call `--registry` | no `.npmrc` write |
| `pypiIndex` (env) | `PIP_*` / `UV_*` for this run | no |
| `pypiIndex` (config) | `~/.config/pip/pip.conf` / `%APPDATA%\pip\pip.ini` | **yes** |
| `goProxy` | `go env -w GOPROXY` (`%APPDATA%\go\env`) | **yes**, if `go` exists |
| `scoopBuckets` | `scoop bucket rm/add` | **yes** |

Persistence happens during a full run whenever the selected profile has a value — it is not
tied to `--apps`, so `--apps none` still updates `pip.conf`. Picking an empty profile later does
**not** revert these files; clean up manually:

```bash
pip config unset global.index-url
go env -w GOPROXY=          # or delete $GOENV
scoop bucket rm <name>      # then re-add the default bucket
```

## Customization

**Add software** — append to the OS manifest:

```json
{ "packages": ["starship"], "scoopPackages": ["starship"] }
```

**Add a config entry** — append to `configs`:

```json
{ "name": "starship", "source": "configs/starship", "target": "~/.config/starship" }
```

Every entry is a **copy**: the previous target is archived to `~/.dotfiles_backup_*` and replaced;
there is no other method. Optional fields: `targets`, `exclude`, `ifMissing`, `when`.
Placeholders: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.

Directories are copied as a whole, which is how `~/.pi/agent` is deployed (Pi discovers
`~/.pi/agent/skills` on its own). Windows Terminal is a plain file copy too: the template has no
machine-specific fields, so the previous `settings.json` — including `defaultProfile` /
`profiles.list` — is archived before the template replaces it.

## Font

`install` deploys [Maple Mono NF CN](https://github.com/subframe7536/maple-font) (terminal),
[Inter](https://github.com/rsms/inter) (Latin UI) and
[Source Han Sans SC](https://github.com/adobe-fonts/source-han-sans) (CJK UI) from their GitHub
releases. All three are licensed under SIL OFL 1.1. Source Han Sans SC is a ~95 MB download.
Termux keeps only Maple because it supports a single terminal font. Downloads use
`githubProxy` / `proxy`; failures are non-fatal.

## Acknowledgements

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm tuning reference.
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code artwork (`configs/code/VSCode-Thick.png`), [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — background artwork:
  - `configs/code/background.png`: [CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - `configs/wezterm/background.png`: [CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
