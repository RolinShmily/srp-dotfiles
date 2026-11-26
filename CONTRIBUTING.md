# Contributing

Thanks for taking the time to contribute.

## Before you start

- Read [README](README.md) for usage.
- Read [docs/development.md](docs/development.md) for local setup, tests, extension guides, and Worker deployment.
- Read [docs/design.md](docs/design.md) for project principles and non-goals.

## Ways to contribute

- **Bug**: open an issue with the **Bug** template. Include OS, exact command, expected vs actual output, Python/Node versions, and the commit hash.
- **Feature**: open an issue with the **Feature** template. Describe the problem first, then the proposal.
- **Pull request**: fork the repository, create a branch, run the checks below, and open a PR.

## Development

The Python engine uses only the standard library, so there is nothing to `pip install`. Node.js 20+ is required for Worker tests and Wrangler.

Run the same checks as CI:

```bash
python -m compileall -q scripts
python -m unittest discover -s scripts/tests -v
python scripts/gen_catalog.py --check
node --check worker/index.js
node --check worker/public/app.js
node worker/test.mjs
sh -n install.sh
```

If `pwsh` is available, also parse `install.ps1` as described in [docs/development.md](docs/development.md#tests-and-checks).

`worker/public/catalog.json` is generated from `manifest/*.json`. Regenerate and commit it after any manifest change:

```bash
python scripts/gen_catalog.py
```

## Pull request checklist

- [ ] Tests pass.
- [ ] `worker/public/catalog.json` regenerated when `manifest/*.json` changed.
- [ ] Docs updated when behavior, CLI, manifest schema, or Worker routes changed.
- [ ] Third-party assets and `THIRD_PARTY_NOTICES.md` updated together.
