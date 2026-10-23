#!/usr/bin/env node
// scripts/lib/pi-inject-resources.js — 写入 Pi settings.json 的统一资源集合。
//
// 用法: node pi-inject-resources.js <settings.json> <manifest-os>
//
// manifest 的 <os>.piResources 支持:
//   packages    npm:, git:, https: 或 @repo/... 本地 Pi package
//   extensions  本地扩展文件/目录
//   skills      本地 Skill 文件/目录
//   prompts     本地 Prompt 文件/目录
//
// @repo/... 与 ~/... 在部署时展开为绝对路径；外部 package 来源原样保留。

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MANIFEST_DIR = join(REPO_ROOT, "manifest");
const [settingsPath, manifestOs] = process.argv.slice(2);

if (!settingsPath || !manifestOs) {
  console.error("Usage: node pi-inject-resources.js <settings.json> <manifest-os>");
  process.exit(1);
}

function resolveSource(value) {
  const source = String(value).trim();
  if (source.startsWith("@repo/")) {
    return join(REPO_ROOT, source.slice("@repo/".length));
  }
  if (source === "~") return homedir();
  if (source.startsWith("~/")) {
    return join(homedir(), source.slice(2));
  }
  return source;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Cannot parse ${label} ${path}: ${reason}`);
    process.exit(2);
  }
}

const manifestPath = join(MANIFEST_DIR, `${manifestOs}.json`);
const section = readJson(manifestPath, `manifest (${manifestOs})`);
const resources = section?.piResources;
if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
  console.error(`Manifest profile '${manifestOs}' does not define piResources`);
  process.exit(3);
}

const settings = readJson(settingsPath, "settings");
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  console.error(`Settings root must be a JSON object: ${settingsPath}`);
  process.exit(2);
}

const resourceKeys = ["packages", "extensions", "skills", "prompts"];
for (const key of resourceKeys) {
  const values = Array.isArray(resources[key]) ? resources[key] : [];
  settings[key] = values
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map(resolveSource);
}

const temporaryPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}`;
writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
renameSync(temporaryPath, settingsPath);

console.log(
  `[OK] Pi resources written for ${manifestOs}: ` +
  `${resourceKeys.map((key) => `${key}=${settings[key].length}`).join(", ")}`,
);
