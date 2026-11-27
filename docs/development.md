# Development

Local setup, build and test commands, Worker deployment, CI workflows, and extension guides for the
Python engine and the Cloudflare Worker.

## Toolchain

| Tool | Version | Used for |
| :--- | :--- | :--- |
| Python | 3.9+ | Installer engine, unit tests, and catalog generation |
| Node.js | 20+ | Worker syntax checks, route tests, and Wrangler |
| Wrangler | 4.x | Local Worker dev server and Cloudflare deployment (`assets` requires v4) |
| PowerShell (`pwsh`) | 7+ (optional) | Parsing `install.ps1` locally on Linux/macOS |
| git | any | Repository operations |

The Python engine uses only the standard library; there is nothing to `pip install`.

```bash
git clone https://github.com/RolinShmily/dotfiles.git
cd dotfiles
```

## Running from source

Invoke the Python entry point directly while iterating:

```bash
python scripts/main.py --help
python scripts/main.py --catalog --os arch
python scripts/main.py -y --os arch --dry-run
python scripts/main.py -c -y --os arch
```

`install.sh` / `install.ps1` check Python, locate or refresh the repository checkout, and then hand
over to `scripts/main.py`:

```bash
./install.sh --help
./install.sh --dry-run -y
```

`--dry-run` prints every planned step without executing commands or touching files and is the safest
way to verify manifest or engine changes.

### Windows PowerShell 5.1

Windows 10/11 defaults to the `Restricted` execution policy, so running a local `.ps1` script fails
with "running scripts is disabled on this system". Relax it for the current session first:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1 -y
```

`-Scope Process` affects only the current shell and requires no administrator privileges. A full
install also sets `RemoteSigned` for the current user, allowing future sessions to run
`.\install.ps1` directly.

Remote one-liners (matching the web configurator output; no local `.ps1` file or `Set-ExecutionPolicy` required):

```powershell
# Default interactive menu (Enter runs full auto-install)
irm https://dot.srprolin.com | iex

# With explicit CLI flags in memory
& ([scriptblock]::Create((irm https://dot.srprolin.com/install.ps1))) -y --mirror cn
```

Fallbacks when running from a local clone under a group-policy-pinned execution policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -y
Get-Content .\install.ps1 -Raw | Invoke-Expression
```

## Tests and checks

Run the local equivalents of the `.github/workflows/test.yml` jobs before pushing:

```bash
python -m compileall -q scripts
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
python scripts/main.py --help > /dev/null
python scripts/main.py --catalog --os arch > /dev/null
python scripts/main.py -c -y --os arch --dry-run > /dev/null
python scripts/main.py -y --os arch --dry-run > /dev/null
python scripts/main.py -y --os windows --dry-run > /dev/null
sh -n install.sh
node --check worker/index.js
node --check worker/public/app.js
node worker/test.mjs
```

If PowerShell (`pwsh`) is installed, also validate `install.ps1` syntax:

```bash
pwsh -NoProfile -Command '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("$PWD/install.ps1", [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { Write-Error $_.Message }; exit 1 }'
```

All unit tests run completely offline:
- `scripts/tests/` exercises catalog generation, manifest loading, message key coverage, mirror
  resolution, proxy scheme detection, interactive startup menu & step confirmation (`test_runner.py`),
  Windows shim resolution (`test_run.py`), and package manager fallbacks (`dnf`, `pacman`, `apt`,
  `pkg`, `winget`, `scoop`, fonts, login shell).
- `worker/test.mjs` mocks the `ASSETS` binding and upstream script fetch to test routing, User-Agent
  detection, `buildCommand`, `buildMirrorFlags`, and `buildProxyFlag`.

## Catalog build workflow

`worker/public/catalog.json` is a generated artifact built from `manifest/*.json`:

```bash
python scripts/gen_catalog.py           # regenerate worker/public/catalog.json
python scripts/gen_catalog.py --check   # exit non-zero if out of sync
```

Regenerate and commit `worker/public/catalog.json` after any edit to `manifest/<os>.json` or
`manifest/mirror.json`; otherwise both `test.yml` and `deploy.yml` fail at the catalog check.

## Worker development & deployment

`worker/` contains a Cloudflare Worker (`worker/index.js`) and static assets (`worker/public/`)
serving the install endpoint and `/config` web configurator.

### Local dev server

```bash
cd worker
npx wrangler@4 dev
```

The local server exposes `/`, `/install.sh`, `/install.ps1`, `/config`, `/api/catalog`,
`/repo.tar.gz`, `/repo.zip`, and `/health` identically to production. See
[Reference](reference.md#worker) for route and catalog schema details.

### Manual deployment

The Worker is deployed as a route on `dot.srprolin.com/*` (requires an existing proxied DNS record
for `dot` in the `srprolin.com` Cloudflare zone):

```bash
python scripts/gen_catalog.py
cd worker
npx wrangler@4 deploy
```

Always use Wrangler 4: Wrangler 3 ignores the `assets` binding in `worker/wrangler.toml`, leaving
`/config` and `/api/catalog` returning 404.

### Automated CI & deployment

Two GitHub Actions workflows live in `.github/workflows/`:

- `test.yml` — runs on every push to `main` and every pull request. Tests Python 3.9 (`ubuntu-22.04`)
  and Python 3.12 (`ubuntu-24.04`) compilation, unit tests, catalog freshness, CLI dry-runs, shell
  and PowerShell syntax, plus Node 20 Worker syntax and route tests.
- `deploy.yml` — runs on pushes to `main` touching `worker/**`, `scripts/**`, `manifest/**`, or
  `.github/workflows/deploy.yml` (and via manual `workflow_dispatch`). Verifies the catalog, runs
  Worker tests, deploys via `cloudflare/wrangler-action@v3` (pinned to Wrangler 4), and smoke-tests
  `/health`, `/config`, and `/api/catalog`.

Repository secrets required for `deploy.yml`:

| Secret | Purpose |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | API token with `Workers Scripts:Edit`, `Workers Routes:Edit`, and `Zone:Read` for `srprolin.com` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

This repository follows a rolling `main` model (the Worker and bootstrap scripts always track
`main`); changes are tracked directly in Git history via Conventional Commits rather than versioned
releases.

## Extending the repository

### Adding an app

Declare packages in `manifest/<os>.json`:

```json
{ "packages": ["starship"] }
```

```json
{ "wingetPackages": ["some.winget.id"], "scoopPackages": ["starship"] }
```

Keep Unix `packages` ordered dependency-first (base toolchain → shell → runtimes → CLI tools → media
tools → applications), because failed batches fall back to per-package installation in manifest
order. See [Reference](reference.md#package-order).

After editing any manifest, regenerate the catalog and verify with `--catalog` and `--dry-run`:

```bash
python scripts/gen_catalog.py
python scripts/main.py --catalog --os arch
python scripts/main.py -y --os arch --dry-run
```

### Adding a config entry

Place the files under `configs/<name>` and declare an entry in the target OS manifest's `configs`
array:

```json
{
  "name": "starship",
  "source": "configs/starship",
  "target": "~/.config/starship"
}
```

- Every config entry is deployed by **copy**; any existing file or directory at the target is
  archived to `~/.dotfiles_backup_*` first.
- Supported optional fields: `targets` (multiple destinations), `exclude` (top-level names to skip),
  `ifMissing` (skip when target already exists), `when` (skip when a guard path does not exist).
- Supported path placeholders: `~`, `%APPDATA%`, `%LOCALAPPDATA%`, `$SCOOP`, `$PROFILE`.
- Directories are copied as a whole (for example `configs/pi` → `~/.pi/agent`).
- Regenerate `worker/public/catalog.json` after adding or renaming a config entry.

### Adding a font

Fonts are registered in `FONT_SPECS` inside `scripts/lib/installers.py`. Each `FontSpec` carries its
upstream archive URL, file-matching patterns, install prefix, and optional Termux member or Scoop
fallback.

1. Add a `FontSpec` entry in `scripts/lib/installers.py`.
2. Append the font ID to the `fonts` array in the relevant `manifest/<os>.json` files (Windows
   supports `fonts` as well).
3. Regenerate `worker/public/catalog.json`.

Termux only installs fonts that define `termux_member`, because Termux supports a single terminal
font (`~/.termux/font.ttf`).

### Testing mirrors and proxies

```bash
python scripts/main.py -y --dry-run --mirror cn
python scripts/main.py -y --dry-run --mirror-npm none
python scripts/main.py -y --dry-run --proxy 127.0.0.1:7890
```

When adding or replacing GitHub proxy prefixes in the `cn` profile of `manifest/mirror.json`, also
keep the fallback `GH_PREFIXES` list in `install.sh` and `install.ps1` synchronized so bootstrap
fetching stays consistent. See [Reference](reference.md#mirror-schema).

## Common issues

- **Catalog check fails**: run `python scripts/gen_catalog.py` and commit the updated
  `worker/public/catalog.json`.
- **Worker `/config` returns 404**: ensure deployment uses `npx wrangler@4 deploy`; Wrangler 3 skips
  the `assets` binding.
- **Font download hangs**: configure `githubProxy` (`--mirror cn`) or pass `--proxy <host:port>`.
- **Unknown app/config ID**: run `python scripts/main.py --catalog --os <os>` and copy the exact ID.
- **`stdin is not a TTY`**: pass `-y` for non-interactive execution, or use `--dry-run`.
- **Unused/missing message key test failure**: `scripts/tests/test_messages.py` verifies that every
  key in `scripts/lib/messages.py` is referenced and every referenced key exists.
