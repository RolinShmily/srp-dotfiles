---
name: subagent
description: Dispatch, message, and collaborate with parallel, full-powered Pi subagent workers running in split terminal panes or silent background processes.
---

# Subagent

Use the native `subagent` tool to delegate tasks to independent, full-powered Pi instances ("workers"). Workers run in dedicated split terminal panes (inside tmux or Zellij) or run silently as background processes (in standard terminals, VSCode, CI/CD, or headless environments). Every worker inherits all standard tools, skills, and extensions, and operates completely asynchronously.

## Spawning Workers

Call the `subagent` tool directly. The tool returns **immediately** with an acknowledgement. You do **not** need to wait or poll:

```json
subagent({
  "task": "Investigate the authentication middleware in src/auth.ts and propose fixes.",
  "name": "auth-audit"
})
```

- `task`: Clear, comprehensive instructions for the worker.
- `name`: Short, descriptive identifier (e.g. `frontend`, `db-migration`, `tester`).
- `model`: (Optional) Model override (e.g. a faster model for simple exploration).
- `cwd`: (Optional) Working directory for the worker.

### Parallel Workers

You can dispatch **multiple workers in parallel in a single turn**:

```json
[
  { "name": "subagent", "arguments": { "task": "Audit frontend router in src/routes/", "name": "frontend" } },
  { "name": "subagent", "arguments": { "task": "Audit database models in src/db/", "name": "backend" } }
]
```

All workers run concurrently in separate split panes. As each worker finishes, the system automatically injects its final result into your conversation as a **steer message**, waking you up to review the findings.

## Non-Blocking Principle

- **DO NOT** write bash scripts, `sleep` commands, `tail` logs, or polling loops to check on a worker.
- **DO NOT** fabricate or assume worker results before receiving the steer message.
- After calling `subagent`, either end your turn immediately or work on other independent tasks. The harness will wake you with the result as soon as it is ready.

## Answering Worker Questions

Workers have an `ask_question` tool. When a worker encounters ambiguity or needs a decision:
1. The worker pauses its work and marks itself as `waiting: ask`.
2. You receive a steer notification: `[Subagent "<name>" question] ...`.
3. Answer the worker by targeting its name:

```json
subagent({
  "target": "auth-audit",
  "task": "Use the JWT verification method rather than session cookies."
})
```

The worker absorbs your guidance, resumes execution, and reports back when done.

## Stopping a Worker

If a worker is no longer needed or is off-track, terminate it:

```json
subagent({
  "target": "auth-audit",
  "action": "stop"
})
```
