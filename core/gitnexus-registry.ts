/**
 * GitNexus registry I/O for gxpm.
 *
 * The registry lives at $HOME/.gitnexus/registry.json as an array of
 * { name, path, ... } entries. gxpm reads it during status checks and
 * writes to it to keep entries in sync with the Worktree lifecycle:
 *
 *   - `pruneDanglingRegistryEntries` removes entries whose `path` no longer
 *     resolves to a git worktree root (used by `gxpm gitnexus prune` and
 *     periodic audits).
 *   - `unregisterRegistryPath` removes the single entry that matches a
 *     freshly-deleted worktree path (used by `gxpm cleanup land --execute`).
 *
 * Both writers go through `atomicWriteRegistry`, which writes to a uniquely
 * named tmp file in the same directory and renames it on top of the live
 * file — so a crash mid-write cannot leave a half-written registry.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RegistryEntry {
  name?: string;
  path?: string;
  indexedAt?: string;
  [k: string]: unknown;
}

export type DanglingReason =
  | "missing-path-field"
  | "realpath-failed"
  | "path-does-not-exist"
  | "not-a-worktree-root"
  | "git-rev-parse-failed";

export interface DroppedEntry {
  entry: RegistryEntry;
  reason: DanglingReason;
  detail?: string;
}

export interface PruneOutcome {
  registryPath: string;
  total: number;
  kept: RegistryEntry[];
  dropped: DroppedEntry[];
}

export interface UnregisterOutcome {
  registryPath: string;
  removed: boolean;
  reason?: "registry-missing" | "entry-not-found";
}

export function defaultRegistryPath(home: string = process.env.HOME ?? ""): string {
  return join(home, ".gitnexus", "registry.json");
}

export class RegistryReadError extends Error {
  constructor(public readonly registryPath: string, public readonly cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`failed to read GitNexus registry at ${registryPath}: ${causeMsg}`);
    this.name = "RegistryReadError";
  }
}

export class RegistryMissingError extends Error {
  constructor(public readonly registryPath: string) {
    super(`GitNexus registry not found: ${registryPath}`);
    this.name = "RegistryMissingError";
  }
}

export function listRegistryEntries(registryPath: string = defaultRegistryPath()): RegistryEntry[] {
  if (!existsSync(registryPath)) throw new RegistryMissingError(registryPath);
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("registry root is not an array");
    }
    return parsed as RegistryEntry[];
  } catch (err) {
    if (err instanceof RegistryMissingError) throw err;
    throw new RegistryReadError(registryPath, err);
  }
}

export function classifyEntry(entry: RegistryEntry): { kept: true } | { kept: false; reason: DanglingReason; detail?: string } {
  if (typeof entry.path !== "string") {
    return { kept: false, reason: "missing-path-field" };
  }
  let resolved: string;
  try {
    resolved = realpathSync(entry.path);
  } catch (err) {
    return { kept: false, reason: "realpath-failed", detail: (err as Error).message };
  }
  if (!existsSync(resolved)) {
    return { kept: false, reason: "path-does-not-exist" };
  }
  const top = gitTopLevel(resolved);
  if (top == null) {
    return { kept: false, reason: "git-rev-parse-failed" };
  }
  let topResolved: string;
  try {
    topResolved = realpathSync(top);
  } catch {
    topResolved = top;
  }
  if (topResolved !== resolved) {
    return { kept: false, reason: "not-a-worktree-root", detail: `toplevel=${topResolved}` };
  }
  return { kept: true };
}

export function pruneDanglingRegistryEntries(input: {
  registryPath?: string;
  execute?: boolean;
} = {}): PruneOutcome {
  const registryPath = input.registryPath ?? defaultRegistryPath();
  const entries = listRegistryEntries(registryPath);
  const kept: RegistryEntry[] = [];
  const dropped: DroppedEntry[] = [];
  for (const entry of entries) {
    const verdict = classifyEntry(entry);
    if (verdict.kept) {
      kept.push(entry);
    } else {
      dropped.push({ entry, reason: verdict.reason, detail: verdict.detail });
    }
  }
  if (input.execute && dropped.length > 0) {
    atomicWriteRegistry(registryPath, kept);
  }
  return { registryPath, total: entries.length, kept, dropped };
}

export function unregisterRegistryPath(input: {
  registryPath?: string;
  worktreePath: string;
}): UnregisterOutcome {
  const registryPath = input.registryPath ?? defaultRegistryPath();
  if (!existsSync(registryPath)) {
    return { registryPath, removed: false, reason: "registry-missing" };
  }
  const entries = listRegistryEntries(registryPath);
  const target = resolveSafe(input.worktreePath);
  const kept = entries.filter((entry) => {
    if (typeof entry.path !== "string") return true;
    return resolveSafe(entry.path) !== target;
  });
  if (kept.length === entries.length) {
    return { registryPath, removed: false, reason: "entry-not-found" };
  }
  atomicWriteRegistry(registryPath, kept);
  return { registryPath, removed: true };
}

function atomicWriteRegistry(registryPath: string, entries: RegistryEntry[]): void {
  mkdirSync(dirname(registryPath), { recursive: true });
  const tmpPath = `${registryPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(tmpPath, registryPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

function resolveSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function gitTopLevel(p: string): string | null {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", p, "rev-parse", "--show-toplevel"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const out = result.stdout.toString().trim();
  return out || null;
}
