---
description: Grill the user relentlessly about a plan, decision, or idea until reaching a shared understanding
argument-hint: "[plan or topic]"
---
Grill me relentlessly about the following plan, decision, or idea until we reach a shared understanding:

${@:-"the current plan, architecture, or idea"}

---

Interview me relentlessly until we reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

### 1. Interactive Questioning (High Priority)

- If the `ask_user_question` tool is available, **actively prioritize using it** to interview me step-by-step.
- Drill down on the questions one by one:
  - Set a concise core question in `question`.
  - Provide background, tradeoffs, and impact analysis in `details`.
  - Whenever applicable, provide candidate options in `options` with rich descriptions, placing your recommended option first and appending `"(Recommended)"` to its label.
  - Wait for my answer after each question to reshape the tree and recalculate the next frontier.

### 2. Rounds & Design Tree (Fallback / Batch mode)

If interactive tools are unavailable, work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for my answers before the next round.

Format a round like so:

```markdown
❓ **Q1** - **<question title>**: <question body, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, including multiple choices>

➡️ <your recommended answer>
```

Each round reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

### 3. Facts vs Decisions

Finding _facts_ is your job, never mine. When a frontier question needs a fact from the environment (filesystem, codebase, tools, etc.), look it up yourself or dispatch a sub-agent to find it; don't ask me for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the result; ask the rest of the frontier now. The _decisions_ are mine: put each to me and wait.

### 4. Completion

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until I confirm we have reached a shared understanding.
