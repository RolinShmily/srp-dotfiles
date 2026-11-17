# Development

Local setup, test commands and extension workflow for the Python engine and the Worker.

## Toolchain

| Tool | Version | Used for |
| :--- | :--- | :--- |
| Python | 3.9+ | Installer and catalog generation |
| Node.js | 20+ | Worker tests and Wrangler |
| Wrangler | 4.x | Worker dev/deploy (assets require 4) |
| git | any | Repository operations |

The Python engine uses only the standard library; there is nothing to `pip install`.

```bash
git clone https://github.com/RolinShmily/srp-dotfiles.git
cd srp-dotfiles
```

## Running from source

```bash
python scripts/main.py --help
python scripts/main.py --catalog --os arch
python scripts/main.py -y --os arch --dry-run
python scripts/main.py -c -y --os arch
```

`install.sh` / `install.ps1` add the Python check, repository lookup/clone and then call the same
engine:

```bash
./install.sh --help
./install.sh --dry-run -y
```

`--dry-run` prints every step without executing it and is the safest way to inspect a change.

### Windows PowerShell 5.1

The default execution policy on Windows 10/11 is `Restricted`, so running a local `.ps1` file fails
with "running scripts is disabled on this system". Relax it for the current session first:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1 -y
```

`-Scope Process` only affects the current shell and needs no admin rights. The `install` step also
sets `RemoteSigned` for the current user, so new sessions can run `.\install.ps1` directly.

Remote one-liner (same shape as the configurator output):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;
irm https://dot.srprolin.com/install.ps1 -OutFile install.ps1;
.\install.ps1 -y
```

Fallbacks when a group policy pins the execution policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -y
& ([scriptblock]::Create((irm https://dot.srprolin.com/install.ps1))) -y
Get-Content .\install.ps1 -Raw | Invoke-Expression
```

## Tests and checks

```bash
python -m compileall -q scripts
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
python scripts/changelog.py 1.0.1
node --check worker/index.js
node --check worker/public/app.js
node worker/test.mjs
sh -n install.sh
```

These are the local equivalents of the `ci.yml` jobs.

## Catalog workflow

`worker/public/catalog.json` is generated from the manifests:

```bash
python scripts/gen_catalog.py
python scripts/gen_catalog.py --check   # CI fails if stale
```

Regenerate it after changing any `manifest/<os>.json` or `manifest/mirror.json`.

## Worker development

```bash
cd worker
npx wrangler@4 dev        # local Worker + assets
```

The dev server serves `/config`, `/api/catalog`, `/install.sh` and `/install.ps1` like production.
Route and DNS details are in [References](references.md#worker).

Worker tests run without network:

```bash
node worker/test.mjs
```

`test.mjs` mocks the assets binding and script fetch, then checks routing, UA detection,
`buildCommand`, `buildMirrorFlags` and `buildProxyFlag`.

## Adding a font

Fonts are defined in `FONT_SPECS` (`scripts/lib/installers.py`). Each entry carries the GitHub
release URL, archive filename patterns, an install prefix and optionally a Termux member / Scoop
fallback.

To add one:

1. add a `FontSpec` entry;
2. append the ID to the relevant manifest `fonts` array (Windows also supports `fonts`);
3. regenerate `worker/public/catalog.json`.

Termux only installs fonts with a `termux_member`, because it supports a single terminal font.

## Adding an app or config

Apps are declared in `manifest/<os>.json`:

```json
{ "packages": ["starship"] }
```

```json
{ "wingetPackages": ["some.winget.id"], "scoopPackages": ["starship"] }
```

Configs live under `configs/` and are declared in `configs`:

```json
{
  "name": "starship",
  "source": "configs/starship",
  "target": "~/.config/starship"
}
```

Regenerate the catalog, then test with `--catalog` and `--dry-run`.

## Mirrors while testing

```bash
python scripts/main.py -y --dry-run --mirror cn
python scripts/main.py -y --dry-run --mirror-npm none
python scripts/main.py -y --dry-run --proxy socks5://127.0.0.1:1080
```

Schema and precedence are in [References](references.md#mirror-schema).

## Release

Add a `## [x.y.z]` section to `CHANGELOG.md`, commit, then push a tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

`release.yml` extracts that section and creates or updates the GitHub release. See
[References](references.md#cicd).

## Common development issues

- **Catalog check fails**: run `python scripts/gen_catalog.py`.
- **Worker page 404**: deploy with `npx wrangler@4 deploy`; Wrangler 3 skips the `assets` binding.
- **Font download hangs**: set `githubProxy` or pass `--proxy`; see [References](references.md#mirror-schema).
- **Unknown app/config ID**: run `--catalog` and use the exact ID.
- **`stdin is not a TTY`**: add `-y`, or use `--dry-run`.
