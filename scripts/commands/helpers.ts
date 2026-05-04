import { readFileSync } from "node:fs";

export function readJsonPayloadFromArgs(argv: string[], usagePrefix: string) {
  const dashJson = argv.indexOf("--json");
  const dashFrom = argv.indexOf("--from");
  const useStdin = argv.includes("--stdin");

  const inputs = [dashJson >= 0, dashFrom >= 0, useStdin].filter(Boolean).length;
  if (inputs === 0) {
    throw new Error(`${usagePrefix} requires one of: --json <json> | --from <file> | --stdin`);
  }
  if (inputs > 1) {
    throw new Error(`${usagePrefix}: pick exactly one of --json / --from / --stdin`);
  }

  let raw: string;
  if (dashJson >= 0) {
    raw = argv[dashJson + 1] ?? "";
  } else if (dashFrom >= 0) {
    const file = argv[dashFrom + 1];
    if (!file) throw new Error("--from requires a file path");
    raw = readFileSync(file, "utf8");
  } else {
    raw = readFileSync(0, "utf8");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${usagePrefix}: invalid JSON payload — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parsePositiveIntegerOption(argv: string[], option: string) {
  if (!argv.includes(option)) return undefined;
  const raw = optionRequiredValue(argv, option);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw) {
    throw new Error(`${option} requires a positive integer`);
  }
  return value;
}

export function optionRequiredValue(argv: string[], option: string) {
  const value = optionValue(argv, option);
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function optionValue(argv: string[], option: string) {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

export function payloadTitle(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const title = (payload as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function currentGitBranch() {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  const branch = result.stdout.toString().trim();
  return branch || undefined;
}

export function currentGitRoot() {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  const root = result.stdout.toString().trim();
  return root || undefined;
}

export function detectCanonicalMainRoot() {
  const result = Bun.spawnSync({
    cmd: ["git", "worktree", "list", "--porcelain"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout
    .toString()
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
}

/**
 * Detect whether the current cwd is inside a linked git worktree (not the canonical main checkout).
 */
export function isInsideLinkedWorktree(): boolean {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--git-path", "HEAD"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return false;
  const gitPath = result.stdout.toString().trim();
  // In a linked worktree, git-path resolves to .git/worktrees/<name>/HEAD
  return gitPath.includes("/worktrees/");
}
