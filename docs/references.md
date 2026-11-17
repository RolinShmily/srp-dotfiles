# References

Schemas, IDs and operational contracts.

## CLI

```bash
./install.sh [-a|-i|-c] [-y] [-f] [--os NAME] [--lang zh|en] [--dry-run]
             [--apps IDS] [--configs NAMES] [--mirror-profile NAME]
             [--mirror-NAME VALUE] [--proxy URL] [--catalog]
```

| Flag | Notes |
| :--- | :--- |
| `-a, --all` | install + deploy |
| `-i, --install` | install only |
| `-c, --config` | deploy only |
| `-y, --yes` | required when stdin is not a TTY |
| `-f, --force` | skip backup, overwrite targets |
| `--os` | `arch` / `debian` / `fedora` / `termux` / `windows` |
| `--lang` | `en` / `zh` |
| `--dry-run` | no side effects |
| `--apps` | comma-separated app IDs; `none` |
| `--configs` | comma-separated config names; `none` |
| `--mirror-profile` | profile key from `mirror.json` |
| `--mirror-<name>` | `github`, `npm`, `pypi`, `go`, `scoop`; `none` clears |
| `--proxy` | `socks5://…` or `http(s)://…`; `none` clears |
| `--catalog` | print JSON and exit |

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
| `piResources` | object | All |
| `wingetPackages` | string[] | Windows |
| `scoopPackages` | string[] | Windows |
| `pythonManager` | string | Windows (`uv`) |

### Config entry

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `name` | yes | Stable ID |
| `method` | yes | `link` / `copy` / `custom` |
| `source` | link/copy | Repository-relative, normally `configs/...` |
| `target` / `targets` | link/copy | One or many destinations |
| `exclude` | no | Top-level names to skip |
| `ifMissing` | no | Skip existing copy target unless `--force` |
| `when` | no | Skip when this path does not exist |

Placeholders: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.

### Pi resources

```json
{
  "piResources": {
    "packages": [],
    "extensions": [],
    "skills": ["@repo/configs/pi/skills"],
    "prompts": []
  }
}
```

`@repo/` resolves to the repository root.

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

Precedence: file profile → `--mirror-profile` → `--mirror-*` / `--proxy`.

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
| `/health` | `ok` |

### Catalog (schema 7)

```json
{
  "schema": 7,
  "catalogs": {
    "arch": {
      "apps": [{ "id": "pkg:zsh", "source": "pacman", "name": "zsh", "label": "zsh" }],
      "configs": [{ "id": "zshrc", "label": "zshrc", "method": "link" }],
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
