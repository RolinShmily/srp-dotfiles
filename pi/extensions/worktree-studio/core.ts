import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;

export interface ExperimentRoute {
  name: string;
  approach: string;
  model: string;
  harness?: string;
  harnessSessionId?: string;
  directory: string;
  sessionFile: string;
  logFile: string;
  promptFile: string;
}

export interface Experiment {
  id: string;
  repository: string;
  baseline: string;
  goal: string;
  mode?: "pi" | "multi-harness";
  directory: string;
  routes: [ExperimentRoute, ExperimentRoute];
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  return stdout.trimEnd();
}

/** A dirty parent worktree cannot be reproduced from HEAD without losing context. */
export async function inspectRepository(cwd: string): Promise<{ repository: string; baseline: string }> {
  const repository = await git(cwd, "rev-parse", "--show-toplevel");
  const baseline = await git(repository, "rev-parse", "HEAD");
  const status = await git(repository, "status", "--porcelain", "--untracked-files=normal");
  if (status) {
    throw new Error("当前工作区有未提交或未跟踪的文件，不能从 HEAD 创建等价的探索基线。请先处理这些文件；不会自动暂存或丢弃它们。");
  }
  return { repository, baseline };
}

export async function createWorktrees(experiment: Experiment): Promise<void> {
  await mkdir(experiment.directory, { recursive: true, mode: 0o700 });
  // Leave successfully created worktrees intact if a later creation fails. Never force-remove user files.
  for (const route of experiment.routes) {
    await git(experiment.repository, "worktree", "add", "--detach", route.directory, experiment.baseline);
  }
}

export async function writePrompt(experiment: Experiment, route: ExperimentRoute): Promise<void> {
  await writeFile(route.promptFile, [
    `# The Road Not Taken — ${route.name}`,
    `Goal: ${experiment.goal}`,
    `Your assigned approach: ${route.approach}`,
    `Baseline: ${experiment.baseline}`,
    "Work only inside your assigned worktree. Implement and test this approach independently.",
    "Do not commit, merge, switch branches, delete worktrees, or change files in the original repository.",
    "Do not install or upgrade dependencies without explicit permission. Do not read secret files.",
    "Finish with concise Markdown: what changed, verification performed, limitations, and trade-offs.",
    "Keep exploration focused: make the targeted change, run relevant tests, and finish promptly; avoid unnecessary tool calls.",
    "The coordinator will collect your actual Git diff independently; do not claim success without evidence.",
    "If a decision needs user input, explain the blocker and stop instead of guessing. Do not wait for interactive input.",
    "",
    "## Completion Notification",
    "When you have finished implementing and verifying your changes, run this shell command to notify the coordinator:",
    '  studio-done "concise summary of changes and verification"',
    "This immediately signals the main session coordinator with your summary.",
    "",
  ].join("\n"), "utf8");
}

export interface RouteEvidence {
  head: string;
  status: string;
  diffStat: string;
  diffFile: string;
  untracked: string[];
}

export async function collectEvidence(experiment: Experiment, route: ExperimentRoute): Promise<RouteEvidence> {
  const [head, status, diffStat, diff, untracked] = await Promise.all([
    git(route.directory, "rev-parse", "HEAD"),
    git(route.directory, "status", "--short", "--untracked-files=normal"),
    git(route.directory, "diff", "--stat", "--no-ext-diff", experiment.baseline),
    git(route.directory, "diff", "--binary", "--no-ext-diff", experiment.baseline),
    git(route.directory, "ls-files", "--others", "--exclude-standard", "-z"),
  ]);
  const diffFile = join(experiment.directory, `${route.name}.diff`);
  await writeFile(diffFile, diff ? `${diff}\n` : "", "utf8");
  return {
    head,
    status,
    diffStat,
    diffFile,
    // Untracked contents are not in Git's diff. Keep them in place for review, not silently omitted.
    untracked: untracked.split("\0").filter(Boolean),
  };
}
