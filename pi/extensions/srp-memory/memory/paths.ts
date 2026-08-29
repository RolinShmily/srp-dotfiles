import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const INDEX_FILENAME = "INDEX.md";
export const JOURNEY_FILENAME = "JOURNEY.md";

/** The project-level `.memory/` base. Per-session roots live one level below it. */
export function memoryBaseDir(cwd: string): string {
  return join(cwd, ".memory");
}

/**
 * The per-session memory root: `.memory/<sessionId>/`.
 */
export function sessionMemoryRoot(cwd: string, sessionId: string): string {
  return join(memoryBaseDir(cwd), sessionId);
}

export function indexPath(root: string): string {
  return join(root, INDEX_FILENAME);
}

export function journeyPath(root: string): string {
  return join(root, JOURNEY_FILENAME);
}

/** Read `.memory/JOURNEY.md` body, trimmed. Returns undefined when missing or effectively empty. */
export function readJourney(root: string): string | undefined {
  const path = journeyPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const body = readFileSync(path, "utf-8").trim();
    return body.length > 0 ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic write (temp + rename). Creates parent dirs as needed. */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

/**
 * Resolve a (possibly relative) path and confirm it stays inside `.memory/`.
 */
export function resolveWithinMemory(root: string, requestedPath: string): string | undefined {
  const base = resolve(root);
  const abs = resolve(base, requestedPath);
  const rel = relative(base, abs);
  if (rel === "" || rel === ".") return abs;
  if (rel.startsWith("..") || resolve(base, rel) !== abs) return undefined;
  return abs;
}

export type TopicFrontMatter = {
  id?: string;
  title?: string;
  summary?: string;
  updated?: string;
};

export type Topic = TopicFrontMatter & {
  /** Path relative to the project root, e.g. ".memory/<sessionId>/auth.md". */
  path: string;
  /** Bare filename, e.g. "auth.md". */
  filename: string;
};

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Parse leading YAML-ish front-matter.
 */
export function parseFrontMatter(content: string): { front: TopicFrontMatter; body: string } {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) return { front: {}, body: content };
  const front: TopicFrontMatter = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "id" || key === "title" || key === "summary" || key === "updated") {
      front[key] = value;
    }
  }
  return { front, body: content.slice(match[0].length) };
}

/**
 * List parsed topic files under a session memory root, sorted by filename.
 */
export function listTopics(root: string): Topic[] {
  if (!existsSync(root)) return [];
  const cwd = resolve(root, "..", "..");
  const topics: Topic[] = [];
  for (const filename of readdirSync(root)) {
    if (!filename.endsWith(".md") || filename === INDEX_FILENAME || filename === JOURNEY_FILENAME) continue;
    let content: string;
    try {
      content = readFileSync(join(root, filename), "utf-8");
    } catch {
      continue;
    }
    const { front } = parseFrontMatter(content);
    topics.push({ ...front, path: relative(cwd, join(root, filename)), filename });
  }
  topics.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  return topics;
}
