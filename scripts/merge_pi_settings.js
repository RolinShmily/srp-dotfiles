#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [settingsPath, templatePath, backupDir, ...packages] = process.argv.slice(2);

if (!settingsPath || !templatePath || !backupDir) {
  console.error("用法: merge_pi_settings.js <settings> <template> <backup-dir> [packages...]");
  process.exit(2);
}

function parseObject(path, content) {
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settings 根节点必须是 JSON 对象");
    }
    return value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${reason}`);
  }
}

function readTemplate() {
  return parseObject(templatePath, readFileSync(templatePath, "utf8"));
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function backupExisting() {
  if (!existsSync(settingsPath)) return;
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, "pi-settings.json");
  renameSync(settingsPath, backupPath);
  console.error(`[WARN] 已备份异常 Pi settings: ${settingsPath} -> ${backupPath}`);
}

let settings;
let initializedFromTemplate = false;

if (!existsSync(settingsPath)) {
  settings = readTemplate();
  initializedFromTemplate = true;
} else {
  try {
    const content = readFileSync(settingsPath, "utf8");
    settings = parseObject(settingsPath, content);
  } catch (error) {
    backupExisting();
    settings = readTemplate();
    initializedFromTemplate = true;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[WARN] 现有 Pi settings 无法使用，已从模板恢复: ${reason}`);
  }
}

function packageKey(value) {
  if (typeof value === "string") return `source:${value}`;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.source === "string") {
    return `source:${value.source}`;
  }
  return `json:${JSON.stringify(value)}`;
}

const existingPackages = Array.isArray(settings.packages) ? settings.packages : [];
const mergedPackages = [];
const packageKeys = new Set();
for (const value of [...existingPackages, ...packages]) {
  if (typeof value !== "string" && (!value || typeof value !== "object")) continue;
  const key = packageKey(value);
  if (packageKeys.has(key)) continue;
  packageKeys.add(key);
  mergedPackages.push(value);
}
settings.packages = mergedPackages;

// Detach a legacy repository symlink so runtime settings are not maintained by git.
if (existsSync(settingsPath) && lstatSync(settingsPath).isSymbolicLink()) {
  unlinkSync(settingsPath);
}

atomicWrite(settingsPath, settings);

if (initializedFromTemplate) {
  console.error(`[OK] 已初始化 Pi settings: ${settingsPath}`);
}
console.error(`[OK] Pi packages 已合并去重 (${mergedPackages.length} 个)。`);
