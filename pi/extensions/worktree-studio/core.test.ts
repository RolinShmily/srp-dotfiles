import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { collectEvidence, createWorktrees, inspectRepository, writePrompt, type Experiment } from "./core.ts";

const exec = promisify(execFile);

async function command(cwd: string, ...args: string[]) {
  return exec("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

test("clean baseline, independent worktrees, tracked and untracked evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-road-test-"));
  const repo = join(root, "source");
  try {
    await command(root, "init", repo);
    await writeFile(join(repo, "file.txt"), "before\n", "utf8");
    await command(repo, "add", "file.txt");
    await command(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
    const { repository, baseline } = await inspectRepository(repo);
    const directory = join(root, "results");
    const routes = (["route-a", "route-b"] as const).map((name) => ({
      name, approach: name, model: "provider/model", directory: join(directory, name),
      sessionFile: join(directory, `${name}.jsonl`), logFile: join(directory, `${name}.log`),
      promptFile: join(directory, `${name}.prompt.md`),
    })) as Experiment["routes"];
    const experiment: Experiment = { id: "test", repository, baseline, goal: "compare", directory, routes };
    await createWorktrees(experiment);
    await writePrompt(experiment, routes[0]);
    assert.match(await readFile(routes[0].promptFile, "utf8"), /Do not commit/);
    await writeFile(join(routes[0].directory, "file.txt"), "after\n", "utf8");
    await writeFile(join(routes[0].directory, "new.txt"), "new\n", "utf8");
    const first = await collectEvidence(experiment, routes[0]);
    const second = await collectEvidence(experiment, routes[1]);
    assert.match(first.status, /file\.txt/);
    assert.deepEqual(first.untracked, ["new.txt"]);
    assert.match(await readFile(first.diffFile, "utf8"), /\+after/);
    assert.equal(second.status, "");
    assert.equal(await readFile(join(repo, "file.txt"), "utf8"), "before\n");
    await assert.rejects(inspectRepository(routes[0].directory), /未提交或未跟踪/);
    await writeFile(join(repo, "untracked.txt"), "user data", "utf8");
    await assert.rejects(inspectRepository(repo), /未提交或未跟踪/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
