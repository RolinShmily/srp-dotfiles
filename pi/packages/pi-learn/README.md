# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

My AI learning system from this video: [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU).

This is a personal system I built for myself, shared as-is. Built as a pi configuration: the teaching philosophy encoded in a skill, a few small extensions, and agent definitions.

## What's in it

- `skills/teach/` — the philosophy and the process
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture
- `extensions/ask-user-question.ts` — the agent asks you questions through a UI popup (tool name: `learn_ask_questions`)
- `extensions/quiz/` — graded questions with instant feedback (✓/✗, correct answer, explanation)
- `extensions/md-log/` — link a markdown file to the session
- `extensions/visual-tools/` — tools for visualization subagents
- `subagents/` — bundled pane-based subagent runtime (tmux + Zellij), providing `sub_agent`, `sub_agent_message`, `sub_agents_list`, and status tracking
- `agents/` — `researcher`, `svg-maker`, `mermaid-maker`, `scout`, `worker`: the subagents the system delegates to

## Install

This repo **is** a `.pi` directory. From your learning project's root:

```bash
git clone https://github.com/amosblomqvist/learn .pi
```

Then open pi in that directory. (Or copy the pieces you want into your existing project config.)

## Requirements

- [pi](https://github.com/earendil-works/pi)
- Multiplexer: tmux or Zellij (required only when spawning async subagents like `researcher` or diagram makers into background panes).
- **Subagents (Batteries-Included)**: The `subagents/` submodule is bundled directly inside this package. It registers `sub_agent`, `sub_agent_message`, and `sub_agents_list` under the `sub_` namespace so it never collides with any global `subagent` CLI or extensions. All visual and web tools (`write_mermaid`, `render_svg`, `sub_web_search`, etc.) are resolved natively.
- `ask-user-question` — use the copy bundled here. Its tool is named **`learn_ask_questions`** so it can coexist with a global `ask_user_question` extension instead of replacing it; the teaching skills and the md-log extension all target the bundled one. Both register the same shared UI lock (`__piSharedUiLock`), so popups from either still serialize against each other instead of fighting.

## Notes

You can run the system without subagents. The main session does the teaching. You just lose the researcher (truth verification) and the generated visuals.

The teaching skill is written for one learner (me). Edit the skill to fit how you learn best.
