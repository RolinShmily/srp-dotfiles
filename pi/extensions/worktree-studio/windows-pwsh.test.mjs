import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { renderSubagentCommand, psEscape } from "../subagent/mux.ts";

const exec = promisify(execFile);
const extensionDir = dirname(fileURLToPath(import.meta.url));
const studioDoneMjs = join(extensionDir, "studio-done.mjs");

// Check if pwsh.exe is available (via WSL Windows interop)
const hasPwsh = (() => {
  try {
    const res = spawnSync("pwsh.exe", ["-NoProfile", "-Command", "Write-Output 'ok'"], { encoding: "utf8" });
    return res.status === 0 && res.stdout.includes("ok");
  } catch {
    return false;
  }
})();

test("renderSubagentCommand generates valid PowerShell script syntax", () => {
  const oldPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const spec = {
      cwd: "C:\\Users\\Test Repo",
      env: [["FOO", "bar with spaces"], ["UNICODE", "测试"]],
      args: ["pi", "--approve", "--model", "custom/model", "@C:\\path\\prompt.md"],
    };
    const { script, scriptExt } = renderSubagentCommand(spec);
    assert.equal(scriptExt, ".ps1");
    assert.ok(script.includes("$OutputEncoding = [System.Text.Encoding]::UTF8"));
    assert.ok(script.includes("Set-Location -LiteralPath 'C:\\Users\\Test Repo'"));
    assert.ok(script.includes("$env:FOO = 'bar with spaces'"));
    assert.ok(script.includes("$env:UNICODE = '测试'"));
    assert.ok(script.includes("__SUBAGENT_DONE_"));
  } finally {
    Object.defineProperty(process, "platform", { value: oldPlatform, configurable: true });
  }
});

test("Windows pwsh.exe executes generated .ps1 script and reports exit codes", { skip: !hasPwsh }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ps-e2e-"));
  try {
    // Generate script using renderSubagentCommand with Windows mock
    const oldPlatform = process.platform;
    let scriptContent = "";
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const spec = {
        cwd: null,
        env: [["TEST_VAR", "value from env"], ["UNICODE_VAR", "中文测试"]],
        args: ["node", "-e", "console.log(process.env.TEST_VAR + ' ' + process.env.UNICODE_VAR); process.exit(0)"],
      };
      const rendered = renderSubagentCommand(spec);
      scriptContent = "\uFEFF" + rendered.script;
    } finally {
      Object.defineProperty(process, "platform", { value: oldPlatform, configurable: true });
    }

    const scriptFile = join(dir, "run.ps1");
    await writeFile(scriptFile, scriptContent, "utf8");

    // Convert WSL path to Windows path
    const winPath = execFileSync("wslpath", ["-w", scriptFile], { encoding: "utf8" }).trim();

    const { stdout } = await exec("pwsh.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& '${winPath}'; exit $LASTEXITCODE`,
    ]);

    assert.match(stdout, /value from env 中文测试/);
    assert.match(stdout, /__SUBAGENT_DONE_0__/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows pwsh.exe executes studio-done wrapper and creates sidecars", { skip: !hasPwsh }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ps-studio-done-"));
  try {
    const exitFile = join(dir, "route.jsonl.exit");
    const turnFile = join(dir, "route.jsonl.turn.json");
    const winExitFile = execFileSync("wslpath", ["-w", exitFile], { encoding: "utf8" }).trim();

    const psContent = `
$env:PI_WORKTREE_STUDIO_EXIT_FILE = '${winExitFile}'
node '${execFileSync("wslpath", ["-w", join(dir, "studio-done.mjs")], { encoding: "utf8" }).trim()}' 'Windows pwsh completed task'
`;
    // Copy studio-done.mjs
    const scriptSrc = await readFile(studioDoneMjs, "utf8");
    await writeFile(join(dir, "studio-done.mjs"), scriptSrc);
    await writeFile(join(dir, "test-done.ps1"), "\uFEFF" + psContent);

    const winTestFile = execFileSync("wslpath", ["-w", join(dir, "test-done.ps1")], { encoding: "utf8" }).trim();

    const { stdout } = await exec("pwsh.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& '${winTestFile}'`,
    ]);

    assert.match(stdout, /Coordinator notified/);
    const exit = JSON.parse(await readFile(exitFile, "utf8"));
    assert.equal(exit.type, "done");
    const turn = JSON.parse(await readFile(turnFile, "utf8"));
    assert.equal(turn.summary, "Windows pwsh completed task");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
