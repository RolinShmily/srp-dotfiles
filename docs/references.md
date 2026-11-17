# References

Schemas, IDs and operational contracts.

## CLI

```bash
./install.sh [-c] [-y] [--os NAME] [--dry-run]
             [--apps IDS] [--configs NAMES] [--mirror NAME]
             [--mirror-NAME VALUE] [--proxy URL] [--catalog]
```

| Flag | Notes |
| :--- | :--- |
| `-c, --config` | deploy only |
| `-y, --yes` | required when stdin is not a TTY |
| `--os` | `arch` / `debian` / `fedora` / `termux` / `windows` |
| `--dry-run` | no side effects |
| `--apps` | comma-separated app IDs; `none` |
| `--configs` | comma-separated config names; `none` |
| `--mirror` | profile key from `mirror.json` |
| `--mirror-<name>` | `github`, `npm`, `pypi`, `go`, `scoop`; `none` clears |
| `--proxy` | `socks5://…` or `http(s)://…`; `none` clears |
| `--catalog` | print JSON and exit |

List flags (`--apps`, `--configs`, `--mirror-*`) accept comma-separated values. On PowerShell an
unquoted `a,b` is parsed as an array, so the configurator always quotes these values
(`--apps "a,b"`); the CLI also accepts the expanded form (`--apps a b`) for hand-typed commands.

## App and config IDs

| ID | Source |
| :--- | :--- |
| `pkg:<name>` | Unix `packages` |
| `winget:<id>` | Windows `wingetPackages` |
| `scoop:<name>` | Windows `scoopPackages` |
| `font:<name>` | `fonts` / Maple entry |
| `npm:<name>` | `npmGlobals` |
| `skill:<item>` | `skillsAdd` |
| `<name>` | config entry `name` (`--configs` only) |

## Manifest schema

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
| `pythonManager` | string | Windows (`uv`) |

### Config entry

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `name` | yes | Stable ID |
| `source` | yes | Repository-relative, normally `configs/...` |
| `target` / `targets` | yes | One or many destinations |
| `exclude` | no | Top-level names to skip |
| `ifMissing` | no | Skip an existing copy target |
| `when` | no | Skip when this path does not exist |

Placeholders: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.

## Mirror schema

```json
{
  "proxy": "",
  "profile": "global",
  "profiles": {
    "global": {},
    "cn": {
      "githubProxy": ["..."],
      "npmRegistry": "...",
      "pypiIndex": ["..."],
      "goProxy": "...",
      "scoopBuckets": ["..."]
    }
  }
}
```

| Field | Type | Semantics |
| :--- | :--- | :--- |
| `githubProxy` | array | Tried in order for GitHub downloads |
| `npmRegistry` | string | npm registry |
| `pypiIndex` | string/array | pip + uv index, extra indexes after the first |
| `goProxy` | string | Written to `GOPROXY` |
| `scoopBuckets` | array/object | `name = url` entries |

Precedence: file profile → `--mirror` → `--mirror-*` / `--proxy`.

Side effects on disk (only during a full run, i.e. without `-c`):

| Setting | Written to | Persistent |
| :--- | :--- | :--- |
| `proxy` | process env (`ALL_PROXY`, `HTTP(S)_PROXY`, `npm_config_proxy`) | no |
| `githubProxy` | nowhere (used for URL building) | no |
| `npmRegistry` | process env + `--registry` per npm call | no |
| `pypiIndex` | `PIP_*` / `UV_*` env, plus `pip.conf` / `pip.ini` | **yes** (config file) |
| `goProxy` | `GOPROXY` env, plus `go env -w` if `go` exists | **yes** (go env file) |
| `scoopBuckets` | `scoop bucket` state | **yes** |

Persisted values are not reverted when the selected profile becomes empty; remove them with
`pip config unset global.index-url`, `go env -w GOPROXY=`, or `scoop bucket rm <name>`.

## Deployment durability

Configs are copied, so the deployed files no longer depend on the clone. Existing targets are
archived to `~/.dotfiles_backup_*` before being replaced. A missing source fails the step and the
installer exits non-zero.

Environment exports during install:

```text
PIP_INDEX_URL, PIP_EXTRA_INDEX_URL
UV_INDEX_URL, UV_DEFAULT_INDEX, UV_EXTRA_INDEX_URL
GOPROXY
npm_config_registry
```

## Fonts

| ID | Source | Platform |
| :--- | :--- | :--- |
| `MapleMono-NF-CN` | `subframe7536/maple-font` latest release | Unix, Windows, Termux |
| `Inter` | `rsms/inter` v4.1 | Unix, Windows |
| `SourceHanSansSC` | `adobe-fonts/source-han-sans` 2.005R (SC OTF) | Unix, Windows |

All three are SIL OFL 1.1. Termux installs only `MapleMono-NF-CN` because it supports a single
`~/.termux/font.ttf`. Windows keeps a Scoop fallback for the Maple family; Inter and Source Han Sans
are installed directly from their GitHub assets.

## Worker

### Routes

| Path | Response |
| :--- | :--- |
| `/` | OS-detected script |
| `/install.sh`, `/install.ps1` | Scripts |
| `/config` | HTML configurator |
| `/api/catalog` | Catalog JSON |
| `/repo.tar.gz` | repository tarball (bootstrap fallback) |
| `/repo.zip` | repository zip (bootstrap fallback) |
| `/health` | `ok` |

### Catalog (schema 7)

```json
{
  "schema": 7,
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

`gen_catalog.py --check` fails if this file is stale.

## Bootstrap

`install.sh` / `install.ps1` fetch the repository without relying on `mirror.json` (which lives inside
it). Order:

1. `git clone` from `SRP_REPO_URL` when set; otherwise GitHub via `SRP_GH_PROXY`, `ghfast.top`,
   `gh-proxy.com`, then direct.
2. If git is unavailable or every clone fails: tarball/zip from `<origin>/repo.tar.gz`
   (default `https://dot.srprolin.com`), then `SRP_REPO_TARBALL`, then codeload (direct and through
   the same proxies).
3. All candidates failed: exit 1 with the exact commands to retry manually.

Environment: `SRP_REPO_URL`, `SRP_GH_PROXY`, `SRP_REPO_TARBALL`, `SRP_REPO_REF` (default `main`),
`SRP_DOTFILES_DIR` (default `~/.srp-dotfiles`), `SRP_INSTALL_ORIGIN` (Worker base URL).

## CI/CD

| Workflow | Trigger | Result |
| :--- | :--- | :--- |
| `ci.yml` | push/PR | Python tests, catalog check, CLI dry-runs, Worker tests |
| `deploy.yml` | main push on relevant paths, manual | Wrangler 4 deploy + endpoint smoke test |
| `release.yml` | `v*` tag, manual | Release from `CHANGELOG.md` section |

Secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, Workers Routes:Edit, Zone:Read),
`CLOUDFLARE_ACCOUNT_ID`.

Release process:

```bash
# add [1.2.3] to CHANGELOG.md, commit, then:
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

## Local checks

```bash
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
node worker/test.mjs
python scripts/changelog.py 1.0.1
sh -n install.sh
```
