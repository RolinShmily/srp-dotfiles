import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { harnessArgs, HARNESSES } from "./harnesses.mjs";

const exec = promisify(execFile);
const runner = join(dirname(fileURLToPath(import.meta.url)), "harness-runner.mjs");

test("static harness adapters configure autonomous commands with sandbox", () => {
  assert.deepEqual(HARNESSES, ["codex", "claude"]);
  assert.ok(harnessArgs("codex", "/tmp/repo", "/tmp/result.md").includes("danger-full-access"));
  assert.ok(harnessArgs("codex", "/tmp/repo", "/tmp/result.md").includes("-a"));
  assert.ok(harnessArgs("claude", "/tmp/repo", "/tmp/result.md").includes("bypassPermissions"));
  assert.throws(() => harnessArgs("unknown", "/tmp/repo", "/tmp/result.md"), /Unsupported harness/);
});

test("mock Codex and Claude Code produce Markdown and exit artifacts", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-harness-test-"));
  const bin = join(root, "bin");
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(bin);
    const shim = `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const name=path.basename(process.argv[1]);
if(process.argv.includes('--version')){console.log('test');process.exit(0)}
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
  if(!input.includes('Goal:'))process.exit(3);
  fs.writeFileSync('changed.txt',name+' changed');
  if(name==='codex'){
    const out=process.argv[process.argv.indexOf('--output-last-message')+1];
    fs.writeFileSync(out,'Codex final answer');
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Codex final answer'}}));
    console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:20,cached_input_tokens:5,output_tokens:3}}));
  }else if(name==='claude'){
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Edit'}]}}));
    console.log(JSON.stringify({type:'result',result:'Claude final answer',is_error:false,total_cost_usd:0.02,usage:{input_tokens:12,output_tokens:4},modelUsage:{'custom/test-model':{}},session_id:'test-session'}));
  }
});
`;
    for (const harness of HARNESSES) {
      await writeFile(join(bin, harness), shim);
      await chmod(join(bin, harness), 0o755);
    }
    for (const harness of HARNESSES) {
      const directory = join(root, harness);
      await mkdir(directory);
      const config = {
        harness, directory,
        promptFile: join(root, "prompt.md"),
        resultFile: join(root, `${harness}.result.md`),
        eventsFile: join(root, `${harness}.events.jsonl`),
        stderrFile: join(root, `${harness}.stderr.log`),
        metadataFile: join(root, `${harness}.metadata.json`),
        exitFile: join(root, `${harness}.exit`),
      };
      await writeFile(config.promptFile, "Goal: compare two changes");
      const configFile = join(root, `${harness}.json`);
      await writeFile(configFile, JSON.stringify(config));
      const { stdout } = await exec(process.execPath, [runner, configFile], {
        cwd: directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.match(stdout, new RegExp(`\\[${harness}\\]`));
      assert.match(await readFile(config.resultFile, "utf8"), /final answer/);
      assert.equal(JSON.parse(await readFile(config.exitFile, "utf8")).type, "done");
      const metadata = JSON.parse(await readFile(config.metadataFile, "utf8"));
      assert.equal(metadata.harness, harness);
      if (harness === "codex") assert.equal(metadata.usage.cached_input_tokens, 5);
      if (harness === "claude") assert.deepEqual([metadata.model, metadata.costUSD], ["custom/test-model", 0.02]);
      assert.match(await readFile(config.eventsFile, "utf8"), /"type"/);
      assert.equal(await readFile(config.stderrFile, "utf8"), "");
      assert.equal(await readFile(join(directory, "changed.txt"), "utf8"), `${harness} changed`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
