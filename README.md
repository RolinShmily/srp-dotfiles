# SrP-Dotfiles

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

`install.sh` / `install.ps1` only check Python and start `scripts/main.py`; if Python is missing they
print these commands and exit.

## Quick start

Online (clones the repo to `~/.srp-dotfiles` when needed):

```bash
curl -fsSL https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.sh | sh -s -- -a -y
```

```powershell
irm https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main/install.ps1 | iex
```

Local:

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git ~/Projects/srp-dotfiles
cd ~/Projects/srp-dotfiles

./install.sh                  # interactive menu
./install.sh -a -y            # install + deploy, no prompts
./install.sh -i -y            # dependencies only
./install.sh -c -f            # configs only, no backup
./install.sh --os arch        # pick a target explicitly
./install.sh --dry-run -a -y  # print the plan only
```

```powershell
.\install.ps1                 # interactive menu
.\install.ps1 -a -y           # install + deploy
.\install.ps1 -c -f           # configs only
.\install.ps1 -a -y -Lang zh  # Chinese UI (default: en)
```

Every step is confirmed individually (core / optional label shown). `-y` approves everything and is
required when stdin is not a TTY. Steps whose dependencies are missing (npm, skills, brew-like tools)
are skipped with a warning instead of failing the run.

## Selective install

`--catalog` prints the concrete apps, configs and mirror profiles as JSON:

```bash
./install.sh --catalog --os arch
```

Pick apps and configs explicitly; mirrors have their own profile/override flags:

```bash
./install.sh -a -y --apps pkg:zsh,font:MapleMono-NF-CN --configs zshrc,tmux --mirror-profile cn
```

- App IDs: `pkg:<name>` (Unix), `winget:<id>`, `scoop:<name>`, `font:<name>`, `npm:<name>`, `skill:<item>`.
- Config IDs are the `name` fields from `manifest/<os>.json`.
- Mirrors: `--mirror-profile cn` picks a preset; `--mirror-<name> <value>` overrides one field
  (`github`, `npm`, `pypi`, `go`, `scoop`); `--proxy <url>` overrides the proxy. `none` clears.
- Omit a flag to select everything; pass `none` to select nothing.

## Layout

```text
.
├── install.sh / install.ps1     # minimal launchers: check Python -> scripts/main.py
├── scripts/
│   ├── main.py                  # CLI, menu, orchestration
│   ├── lib/                     # manifest, mirrors, net, runner, deploy, installers
│   └── configs/                 # custom steps written in Python
├── manifest/
│   ├── arch|debian|fedora|termux|windows.json
│   └── mirror.json              # mirrors & proxy
├── config/                      # application configs
│   └── zsh/ vim/ tmux/ powershell/ pi/ wezterm/ windows-terminal/ zellij/ yazi/ btop/ fastfetch/ code/
└── worker/                      # optional Cloudflare Worker install endpoint
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
| `/health` | health probe |

```bash
python scripts/gen_catalog.py     # refresh worker/public/catalog.json from manifests
cd worker
npx wrangler@4 deploy
```

```bash
curl -fsSL https://dot.srprolin.com | sh -s -- -a -y
```

```powershell
irm https://dot.srprolin.com | iex
```

The page is a thin client: it builds `--apps/--configs/--mirror-*` and nothing else; installation
and validation stay in `scripts/main.py`. The Mirrors section has a profile dropdown plus editable
fields: switching profiles adds `--mirror-profile`, editing a field adds `--mirror-<name>`, and
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
- Pick one with `--mirror-profile cn`; `profile` in the file sets the default.
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
`install` also persists pip (`~/.config/pip/pip.conf` / `%APPDATA%\pip\pip.ini`) and, when `go`
is installed, Go (`go env -w`). Scoop cannot use path-prefix mirrors; with a GitHub proxy or
`proxy`, the Maple font is downloaded directly instead of through Scoop.

## Customization

**Add software** — append to the OS manifest:

```json
{ "packages": ["starship"], "scoopPackages": ["starship"] }
```

**Add a config entry** — append to `configs`:

```json
{ "name": "starship", "method": "link", "source": "config/starship", "target": "~/.config/starship" }
```

| `method` | Meaning | Fields |
| :--- | :--- | :--- |
| `link` | Symlink into the repo (live edits); conflicts go to `~/.dotfiles_backup_*` | `source` + `target`/`targets` |
| `copy` | Overwrite copy, no backup | `source` + `target` |
| `custom` | Run `scripts/configs/<name with - as _>.py` (`run(ctx)`) | — |

Optional fields: `targets`, `exclude`, `ifMissing`, `when`.
Placeholders: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.

Custom modules receive a context with `repo`, `os_name`, `manifest`, `mirrors`, `backup_dir`,
`force`, `runner`, and can call `lib.deploy` helpers. Windows Terminal is such a module: it merges
only the fields the template declares and keeps `defaultProfile` / `profiles.list`.

## Font

[Maple Mono NF CN](https://github.com/subframe7536/maple-font) is installed automatically by
`install` on both platforms; failures are non-fatal and point at `manifest/mirror.json`.

## Acknowledgements

- [KevinSilvester/wezterm-config](https://github.com/KevinSilvester/wezterm-config) — WezTerm tuning reference.
- [Aikoyori/ProgrammingVTuberLogos](https://github.com/Aikoyori/ProgrammingVTuberLogos) — VS Code artwork (`config/code/VSCode-Thick.png`), [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- [Xy (Pixiv 85385041)](https://www.pixiv.net/users/85385041) — background artwork:
  - `config/code/background.png`: [CSGO / Nightlight-Print&Asimov](https://www.pixiv.net/artworks/121230570)
  - `config/wezterm/background.png`: [CSGO / Original Sin-Printstream](https://www.pixiv.net/artworks/121094692)
