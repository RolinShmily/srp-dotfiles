---
name: grill-me
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree systematically across the **frontier**: every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet.

## Question Delivery

### Primary: `ask_user_question` Tool
**Always prioritize using the `ask_user_question` tool** whenever it is available instead of emitting plain text markdown questions.

Since `ask_user_question` handles one core decision per call:
- Ask the most critical unblocked decision on the frontier.
- **`question`**: State the core decision clearly and directly.
- **`details`**: Provide necessary context, trade-offs, and explain how this decision branches the design tree.
- **`options`**: Provide concrete options whenever choices can be framed:
  - Put your recommended choice **first** with `(Recommended)` appended to the `label`.
  - Provide a clear `description` for each option detailing its pros, cons, and downstream implications.
  - Set `multiSelect: true` only if multiple choices apply simultaneously.
  - Omit `options` (or pass `[]`) for open-ended answers (e.g. naming, custom values).
- Once the user answers, update the design tree, recompute the frontier, and proceed to ask the next frontier question using `ask_user_question`.

### Fallback: Formatted Markdown Rounds
If and only if `ask_user_question` is not available in the runtime environment, ask the whole frontier in one round using markdown text:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```
Wait for the user's answers before the next round.

## Tree Evolution & Fact Finding

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
