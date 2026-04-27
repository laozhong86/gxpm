import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DiscoverEntry {
  key: string;
  repos: string[];
}

interface RunGlobalDiscoverInput {
  home?: string;
}

/**
 * Resolve the primary git remote origin URL for a directory.
 * Returns null if the directory is not a git repo or has no remote.
 */
function resolveRemote(cwd: string): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return url || null;
  } catch {
    return null;
  }
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

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cwd === "string") {
      cwds.push(parsed.cwd);
    }
  } catch {
    // fall through to line-by-line parsing
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.cwd === "string") {
        cwds.push(parsed.cwd);
      }
    } catch {
      // ignore malformed lines
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
