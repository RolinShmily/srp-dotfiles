---
name: worktree-studio
description: Orchestrate isolated Git-worktree experiments and compare independently implemented alternatives with real diffs and verification. Use for The Road Not Taken, competing implementation approaches, parallel worktree exploration, or accepting/rejecting agent-produced worktrees. Owns planning, confirmation, directory layout, worker delegation, evidence collection, and comparison; does not auto-integrate or discard results.
---

# Worktree Studio — The Road Not Taken

Separate the workflow from the runtime. Git manages directories; this skill manages the experiment; a delegation tool runs each task in the specified `cwd`. `multi_harness` is one runtime, not a requirement for creating worktrees. Ordinary `subagent` or another available runtime may be used with equivalent explicit directory and lifecycle controls.

## 1. Define and confirm the experiment

- Use experiments only when evidence from genuinely viable alternatives will resolve uncertainty. Do not manufacture alternatives for a routine change.
- Define the common goal, concrete acceptance criteria, each approach, and the number of alternatives. Do not hard-code two workers or require different harnesses.
- Choose a reproducible baseline and name workers by purpose (for example `cache-codex`, `batch-pi`). Identify write overlap and dependencies.
- Confirm the plan with the user **before creating worktrees or launching paid workers**. Explain expected workers/models, directories, resource costs, and retained artifacts. Timeouts are not spending limits; these workers may have full filesystem permissions.
- Respect existing user approval without repeating questions already answered. Do not interpret approval to explore as approval to merge, commit, install dependencies, or delete results.

## 2. Inspect the baseline without disturbing changes

Use Git with argument-safe paths, for example:

```sh
git -C <source> rev-parse --show-toplevel
git -C <source> rev-parse HEAD
git -C <source> status --porcelain=v1 --untracked-files=normal
git -C <source> worktree list --porcelain
```

Read relevant project instructions and code. Record the exact baseline SHA, source directory, and acceptance commands in a plan file outside worker directories.

A dirty source cannot be reproduced from `HEAD`. Stop and explain the discrepancy. Ask the user to resolve the state, or explicitly approve comparing the committed baseline while leaving local changes untouched. Never automatically stash, stage, commit, reset, or copy ignored/secret files. Do not claim an experiment includes uncommitted context when it does not.

## 3. Lay out isolated worktrees

Choose a fresh experiment directory outside the source checkout and never reuse a nonempty path. Record a mapping of approach → worker name → harness/model → absolute worktree path.

For each alternative:

```sh
git -C <source> worktree add --detach <absolute-new-path> <baseline-sha>
```

If creation partially fails, keep successful worktrees and report their paths. Do not force-remove them. Do not use Git locks or branches shared between workers.

Ignored dependencies/build outputs are not copied by Git. Establish what can be verified without installing anything; ask before dependency installation or version changes. A worktree is not a security sandbox.

## 4. Delegate one well-scoped task per directory

Use any suitable runtime. With `multi_harness`, each worker is an equal CLI peer (`pi`, `codex`, `claude`, or `opencode`), not a mode:

```json
{"action":"spawn","name":"cache-codex","harness":"codex","cwd":"/absolute/experiment/cache","task":"Implement the cache approach. Baseline: <sha>. Acceptance: <criteria and commands>. Work only in this directory. Do not commit, merge, switch branches, delete worktrees, modify the source checkout, read secrets, or install dependencies without permission. Report changes, commands actually executed, results, blockers, and trade-offs."}
```

- Give every worker the **same goal and acceptance criteria**, with a different assigned approach where appropriate.
- Include explicit paths, scope, no-go operations, expected artifacts, and verification commands in the task.
- Native TUIs stay open after each turn. Completion arrives as a pushed notification. Do not wait in bash loops, repeatedly capture panes, or continually call `status`.
- Treat `harness-done "summary"` as a summary submission; settlement hooks produce the authoritative turn-completion event. A worker's success claim is not independent verification.
- To clarify, repair, or request more evidence, send a follow-up to the same idle worker:

```json
{"action":"send","target":"cache-codex","task":"Run the missing acceptance check in your existing directory. Report the exact command, result, and remaining limitations; do not integrate or commit."}
```

Use `status` for a user-requested snapshot or diagnosis, not as a waiting loop. If a timeout or trust/permission dialog blocks work, surface it; do not silently bypass additional security controls.

## 5. Collect evidence and independently accept/reject

After notifications arrive, inspect **every** worktree. Keep machine evidence separate from worker summaries:

```sh
git -C <worker-dir> rev-parse HEAD
git -C <worker-dir> status --short --untracked-files=normal
git -C <worker-dir> diff --no-ext-diff --stat <baseline-sha>
git -C <worker-dir> diff --no-ext-diff --binary <baseline-sha>
git -C <worker-dir> ls-files --others --exclude-standard -z
git -C <worker-dir> log --oneline <baseline-sha>..HEAD
```

- Save tracked diffs and inspect untracked deliverables separately: ordinary `git diff` omits new untracked files. Never stage files merely to make a diff appear complete.
- Detect unexpected commits, branch changes, deleted files, dependency edits, out-of-scope changes, and modifications to the original checkout.
- Run comparable acceptance checks yourself when safe. Record command, directory, exit/result, and environment limitations. Do not mark an unrun or permission-blocked check as passed.
- Review correctness, maintainability, scope, performance evidence, compatibility, operational risks, and costs when reported. Do not fabricate absent pricing or infer free usage from zero/missing cost.
- For UI outputs, inspect desktop/mobile rendering if browser access is available; otherwise state that visual validation was not performed.

## 6. Report, recommend, and preserve

Write a comparison report in the experiment directory:

1. Goal, baseline SHA, source path, acceptance criteria.
2. Route/worker/harness/model/directory mapping.
3. Per-route implementation summary, tracked diff, untracked artifacts, unexpected commits, independent test results, and limitations.
4. Comparison table: accepted criteria, failures, trade-offs, evidence gaps, resource/cost observations.
5. Recommendation with reasons, or an explicit statement that evidence is insufficient.
6. Paths to preserved worktrees, runtime sessions/logs, and pending decisions.

Ask before integrating any result. Do not automatically choose a winner, merge, cherry-pick, commit, or delete worktrees.

When the user wants runtime cleanup, `multi_harness({"action":"close","target":"cache-codex"})` closes an idle TUI without deleting working files. For active work, use `stop` first. Explain that stopping a worker is not the same as removing its Git worktree. Any later removal needs separate explicit approval after artifact review.
