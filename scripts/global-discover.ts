import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * Read all { cwd } entries from JSON files in a directory root.
 * Skips missing roots and malformed JSON silently.
 */
function readCwdEntries(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const cwds: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(root, name), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cwd === "string") {
        cwds.push(parsed.cwd);
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return cwds;
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
    ...readCwdEntries(claudeRoot),
    ...readCwdEntries(codexRoot),
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
    result.push({ key, repos: Array.from(repoSet) });
  }

  return result;
}
