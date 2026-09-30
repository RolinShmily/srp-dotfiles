#!/usr/bin/env node
// scripts/lib/pi-inject-packages.js — 把 manifest.json 里的 piPackages 写入 Pi settings.json。
//
// 用法: node pi-inject-packages.js <settings.json> [pkg...]
//
// 只做一件事: 覆盖 settings.json 的 packages 字段，原子写回。
// 不做备份、不做比对、不做字段合并 —— 其余字段完全按原样保留。
//
// 路径令牌（部署时展开，避免在 manifest 里硬编码 clone 位置）:
//   @repo/...  -> 本仓库根目录 + 相对路径
//   ~/...      -> 家目录 + 相对路径
//   npm: / git: / https: 等原样保留

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// scripts/lib/pi-inject-packages.js -> 仓库根
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const [settingsPath, ...packages] = process.argv.slice(2);

if (!settingsPath) {
  console.error("用法: node pi-inject-packages.js <settings.json> [pkg...]");
  process.exit(1);
}

function resolveSource(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("@repo/")) {
    return join(REPO_ROOT, trimmed.slice("@repo/".length));
  }
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`无法解析 ${settingsPath}: ${reason}`);
  process.exit(2);
}

if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  console.error(`${settingsPath} 的根节点必须是 JSON 对象`);
  process.exit(2);
}

const list = packages
  .filter((p) => typeof p === "string" && p.trim() !== "")
  .map(resolveSource);

settings.packages = list;

const temporaryPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}`;
writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
renameSync(temporaryPath, settingsPath);

console.log(`[OK] packages 已写入 ${list.length} 项: ${settingsPath}`);
