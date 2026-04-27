import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Extract a cwd string from a parsed JSON object, checking top-level and payload.cwd. */
function extractCwd(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.cwd === "string") return obj.cwd;
  if (obj.payload && typeof obj.payload === "object") {
    const payload = obj.payload as Record<string, unknown>;
    if (typeof payload.cwd === "string") return payload.cwd;
  }
  return null;
}

export interface DiscoverEntry {
  key: string;
  repos: string[];
}

interface RunGlobalDiscoverInput {
  home?: string;
}

/** Cache for remote resolution to avoid repeated git subprocess calls per cwd. */
const remoteCache = new Map<string, string | null>();

/**
 * Resolve the primary git remote origin URL for a directory.
 * Results are cached by cwd so each directory is queried at most once.
 * Returns null if the directory is not a git repo or has no remote.
 */
function resolveRemote(cwd: string): string | null {
  if (remoteCache.has(cwd)) {
    return remoteCache.get(cwd)!;
  }
  let result: string | null = null;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    result = url || null;
  } catch {
    result = null;
  }
  remoteCache.set(cwd, result);
  return result;
}

/**
 * Read cwd values from a single file.
 * Supports whole-file JSON and line-delimited JSON content.
 */
function readCwdsFromFile(filePath: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const cwds: string[] = [];

  // Try whole-file JSON first; if it succeeds, skip line-by-line to avoid duplicates.
  let isWholeFileJson = false;
  try {
    const parsed = JSON.parse(raw);
    isWholeFileJson = true;
    const cwd = extractCwd(parsed);
    if (cwd) cwds.push(cwd);
  } catch {
    // not valid whole-file JSON; fall through to line-by-line parsing
  }

  if (!isWholeFileJson) {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const cwd = extractCwd(parsed);
        if (cwd) cwds.push(cwd);
      } catch {
        // ignore malformed lines
      }
    }
  }

  return cwds;
}

function listFiles(root: string, recursive: boolean): string[] {
  if (!existsSync(root)) {
    return [];
  }

  let names: string[];
  try {
    names = readdirSync(root).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const name of names) {
    const fullPath = join(root, name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isFile()) {
      files.push(fullPath);
      continue;
    }

    if (recursive && stats.isDirectory()) {
      files.push(...listFiles(fullPath, true));
    }
  }

  return files;
}

/**
 * Read cwd entries from ~/.claude/projects.
 * Supports both flat test fixtures and real one-level slug directories.
 */
function readClaudeCwdEntries(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  let names: string[];
  try {
    names = readdirSync(root).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  for (const name of names) {
    const fullPath = join(root, name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isFile()) {
      files.push(fullPath);
      continue;
    }

    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath, false));
    }
  }

  return files.flatMap(readCwdsFromFile);
}

/**
 * Read cwd entries from ~/.codex/sessions.
 * Supports both flat test fixtures and real nested date directories.
 */
function readCodexCwdEntries(root: string): string[] {
  return listFiles(root, true).flatMap(readCwdsFromFile);
}

/**
 * Scan ~/.claude/projects and ~/.codex/sessions for session JSON files,
 * extract cwd values, resolve git remotes, and deduplicate entries.
 */
export function runGlobalDiscover(input: RunGlobalDiscoverInput = {}): DiscoverEntry[] {
  const home = input.home ?? homedir();

  const claudeRoot = join(home, ".claude", "projects");
  const codexRoot = join(home, ".codex", "sessions");

  const allCwds = [
    ...readClaudeCwdEntries(claudeRoot),
    ...readCodexCwdEntries(codexRoot),
  ];

  // Map from key -> set of cwd paths
  const keyToRepos = new Map<string, Set<string>>();

  for (const cwd of allCwds) {
    const remote = resolveRemote(cwd);
    const key = remote ? `remote:${remote}` : `cwd:${cwd}`;

    if (!keyToRepos.has(key)) {
      keyToRepos.set(key, new Set());
    }
    keyToRepos.get(key)!.add(cwd);
  }

  const result: DiscoverEntry[] = [];
  for (const [key, repoSet] of keyToRepos) {
    result.push({
      key,
      repos: Array.from(repoSet).sort((a, b) => a.localeCompare(b)),
    });
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}
