#!/usr/bin/env node
// scripts/lib/manifest.js — Unix 侧读取 manifest.json 的唯一入口。
//
// 用法:
//   node manifest.js get <os> <key>   打印单个键（数组逐行，对象逐行 JSON）
//   node manifest.js plan <os>        打印 configs 的 TSV 计划表（每行一个部署条目）
//
// plan 列顺序（制表符分隔，条目内的数组用 | 连接）:
//   name  method  source  targets  exclude  ifMissing  when
//
// 退出码: 0 成功 | 1 参数错误 | 2 清单不可读 | 3 键不存在

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "manifest.json");

const [action, osName, key] = process.argv.slice(2);

if (!action || !osName) {
  console.error("用法: node manifest.js get <os> <key> | plan <os>");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (error) {
  console.error(`无法读取 ${MANIFEST}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const section = manifest[osName];
if (!section || typeof section !== "object" || Array.isArray(section)) {
  console.error(`manifest.json 中不存在 OS 段: ${osName}`);
  process.exit(2);
}

/** 把 target / targets 归一成数组 */
function toTargets(entry) {
  if (Array.isArray(entry.targets)) return entry.targets;
  if (typeof entry.target === "string") return [entry.target];
  return [];
}

/** 制表符内联的数组字段 */
function inline(value) {
  if (!Array.isArray(value)) return "";
  return value.join("|");
}

if (action === "get") {
  if (!key) {
    console.error("用法: node manifest.js get <os> <key>");
    process.exit(1);
  }
  if (!(key in section)) {
    console.error(`[${osName}] 中不存在键: ${key}`);
    process.exit(3);
  }

  const value = section[key];
  if (Array.isArray(value)) {
    for (const item of value) {
      console.log(typeof item === "string" ? item : JSON.stringify(item));
    }
  } else if (value !== null && typeof value === "object") {
    console.log(JSON.stringify(value));
  } else {
    console.log(String(value));
  }
  process.exit(0);
}

if (action === "plan") {
  const configs = Array.isArray(section.configs) ? section.configs : [];
  for (const entry of configs) {
    const row = [
      entry.name ?? "",
      entry.method ?? "",
      entry.source ?? "",
      inline(toTargets(entry)),
      inline(entry.exclude),
      entry.ifMissing ? "1" : "",
      entry.when ?? "",
    ];
    console.log(row.join("\t"));
  }
  process.exit(0);
}

console.error(`未知动作: ${action}`);
process.exit(1);
