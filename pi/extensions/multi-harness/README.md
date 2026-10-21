# Multi Harness

A small delegation runtime with one tool, `multi_harness`. `pi`, `codex`, `claude`, and `opencode` are equal CLI peers. The original `subagent` extension remains a separate, lean Pi-only tool.

The runtime accepts **one named worker and an existing cwd**. It does not run Git, create directories for projects, create worktrees, enforce two alternatives, pick models interactively, compare implementations, or ask for workflow approval. Those decisions belong to the caller. The independent [`worktree-studio` skill](../../skills/worktree-studio/SKILL.md) handles isolated alternative implementations and their acceptance review.

## Use

Load `pi/extensions/multi-harness` (the platform manifests include it), or run:

```sh
pi --no-extensions -e ./pi/extensions/multi-harness/index.ts
```

Example tool calls:

```json
{"action":"spawn","name":"reviewer","harness":"claude","cwd":"/existing/project","task":"Review error handling without changing files. Report concrete findings with file paths."}
{"action":"spawn","name":"implementer","harness":"pi","cwd":"/existing/other-directory","task":"Implement the approved fix and run the specified checks.","model":"provider/model"}
{"action":"spawn","name":"opencode-reviewer","harness":"opencode","cwd":"/existing/project","task":"Review the changes and report evidence without editing files."}
{"action":"send","target":"reviewer","task":"Review the revised implementation in the same session."}
{"action":"status"}
{"action":"stop","target":"implementer"}
{"action":"close","target":"reviewer"}
```

- `spawn` is the default action; `name`, `harness`, and `task` are required. `cwd` defaults to the parent directory and must already exist. Names are reserved for the session, including after closing.
- `model` is optional and passed to the selected CLI. Pi defaults to the parent model; external CLIs use their installed defaults. Only the selected executable is checked on demand.
- `spawn` and `send` return after dispatch. **Turn completion is pushed to the real parent Pi session via `pi.sendMessage`**, not by a background wrapper writing a log. Do not poll terminals or run waiting shell loops.
- With tmux/Zellij, each worker runs its **native interactive TUI**. Turn settlement leaves the application open and idle. `send` continues that same application; `close` exits idle TUIs. `stop` terminates active work and its runtime, preserving files.
- Without a supported mux, workers use silent child processes. `send` starts another invocation that resumes the same persisted CLI session. Set `PI_MULTI_HARNESS_BACKEND=process` to force this fallback. This is not a live TUI in headless mode.
- Pi follow-ups use a file inbox and native `pi.sendUserMessage`. OpenCode uses a local server plugin, its native SDK inbox, and the same visible TUI session (no key injection). Codex uses its reported thread ID with `codex queue`; when no ID is available, mux input uses bracketed paste. Claude uses idle-only bracketed paste. Avoid simultaneous human typing and coordinator dispatch; startup trust/permission dialogs may require manual attention. Zellij input transport still requires validation with your installed Zellij/terminal build.

## Notifications and state

Artifacts live in `~/.pi/agent/multi-harness/<worker-id>/`: task prompts, CLI session data/IDs, console/event logs in process mode, completion records, and short TUI screen captures. Working files remain in the caller's `cwd`. No automatic Git report is generated.

`harness-done "summary"` is injected into the worker PATH; `studio-done` is a compatibility alias. It records a proposed summary, **not an early completion event**. Native Codex/Claude hooks, OpenCode's root-session idle events, Pi's `agent_settled`, or the headless process exit publish the authoritative completion. This avoids racing a still-running CLI or notifying twice. Every dispatch has a task ID; stale and duplicate completions are ignored.

The parent subscribes to directory `fs.watch` events, with no periodic terminal capture or completion polling. Screen capture happens once per completed turn. Watcher failures are surfaced rather than silently claiming delivery. A worker's final text is a claim: independently review its files and test results.

Default turn timeout: 15 minutes (`maxMinutes`: 1–120). Headless workers are stopped on timeout. A native TUI stays open and cannot receive a new dispatch until it settles or is stopped. Timeouts do not cap tokens or spending; missing usage/pricing is not zero cost.

Session entries record only worker artifact locations. On session restore/reload, the extension reattaches notification watchers for saved workers. A `controller.lock` prevents another session from controlling the same worker concurrently. After an unclean crash, verify the recorded owner PID is no longer running before manually removing that lock. Normal shutdown releases watchers/locks and stops active tasks; idle TUIs remain open and can be recovered by resuming the parent session.

## Permissions and platform boundaries

- This tool dispatches directly; user confirmation for expensive or risky workflows belongs to the caller/skill. It is not a sandbox.
- Per the configured workflow, Codex runs with `--sandbox danger-full-access -a never`, and Claude with `--permission-mode bypassPermissions`. Workers have the invoking user's filesystem/network privileges. Headless Claude has a $0.50 CLI API budget; interactive mode does not impose that limit. Use only in trusted environments.
- OpenCode uses `--auto`: automatically approve requests not explicitly denied by its configuration. Existing deny rules remain effective. Native mode injects the dependency-free local `opencode-plugin.mjs` through a merged `OPENCODE_CONFIG_CONTENT`; it never edits project/global config files or installs packages. Existing content must be valid JSON. Headless mode uses `opencode run --format json` and resumes by the exact reported `--session` ID. The adapter targets the OpenCode 1.x CLI/plugin API (source-checked against v1.19.3); 2.x API compatibility is not assumed. Install and authenticate the CLI yourself. DeepSeek Harness (`dsh`) is not integrated.
- Pi's project-resource trust flags apply only to loading project resources, not filesystem access. A different cwd does not inherit the parent's project trust automatically.
- Windows requires PowerShell 7 (`pwsh`) for external CLI invocation. Encoded PowerShell commands preserve Unicode, multiline tasks, JSON, and quoted paths. CLI hooks and `harness-done.cmd`/`.ps1` wrappers use the same native Windows Node installation. A mux must be available for visible TUIs; otherwise process fallback applies.
- Existing worktrees, reports, and sessions created by the removed `worktree-studio` extension are left untouched. Its old `the_road_not_taken` tool and two-route manifests are not imported into this runtime. Synchronize platform resources/reload before using the new tool; old running workers should be finished before upgrading.

Validation scripts are kept outside the dotfiles repository. Check extension loading with `pi --no-extensions -e ./pi/extensions/multi-harness/index.ts --list-models '<filter>'`.
