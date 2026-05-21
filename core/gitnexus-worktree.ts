import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type GitNexusWorktreeStatusCode = "ok" | "missing-registry" | "missing-index" | "stale" | "missing-commit";

export interface GitNexusRegistryEntry {
  name?: string;
  path?: string;
  storagePath?: string;
  indexedAt?: string;
  lastCommit?: string;
  stats?: {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    processes?: number;
  };
}

export interface GitNexusWorktreeStatus {
  code: GitNexusWorktreeStatusCode;
  ok: boolean;
  worktreePath: string;
  currentCommit: string;
  registryPath: string;
  entry?: GitNexusRegistryEntry;
  recommendedCommand?: string;
}

export function getGitNexusWorktreeStatus(input: { cwd?: string; home?: string } = {}): GitNexusWorktreeStatus {
  const cwd = input.cwd ?? process.cwd();
  const worktreePath = currentGitRoot(cwd);
  const currentCommit = currentGitCommit(worktreePath);
  const registryPath = join(input.home ?? process.env.HOME ?? "", ".gitnexus", "registry.json");
  const recommendedCommand = gitNexusAnalyzeCommand(worktreePath);

  if (!existsSync(registryPath)) {
    return {
      code: "missing-registry",
      ok: false,
      worktreePath,
      currentCommit,
      registryPath,
      recommendedCommand,
    };
  }

  const entry = findExactRegistryEntry(registryPath, worktreePath);
  if (!entry) {
    return {
      code: "missing-index",
      ok: false,
      worktreePath,
      currentCommit,
      registryPath,
      recommendedCommand,
    };
  }

  if (!entry.lastCommit) {
    return {
      code: "missing-commit",
      ok: false,
      worktreePath,
      currentCommit,
      registryPath,
      entry,
      recommendedCommand,
    };
  }

  if (!commitsMatch(currentCommit, entry.lastCommit)) {
    return {
      code: "stale",
      ok: false,
      worktreePath,
      currentCommit,
      registryPath,
      entry,
      recommendedCommand,
    };
  }

  return {
    code: "ok",
    ok: true,
    worktreePath,
    currentCommit,
    registryPath,
    entry,
  };
}

export function formatGitNexusWorktreeStatus(status: GitNexusWorktreeStatus): string {
  const lines = [
    `Repository: ${status.worktreePath}`,
    `Indexed: ${status.entry?.indexedAt ?? ""}`,
    `Indexed commit: ${status.entry?.lastCommit ?? ""}`,
    `Current commit: ${status.currentCommit}`,
  ];
  const stats = status.entry?.stats;
  if (stats) {
    lines.push(`Stats: ${stats.files ?? ""} files, ${stats.nodes ?? ""} symbols, ${stats.edges ?? ""} edges`);
  }

  if (status.code === "ok") {
    lines.push("Status: up-to-date");
  } else if (status.code === "missing-registry") {
    lines.push(`Status: missing GitNexus registry (${status.registryPath})`);
  } else if (status.code === "missing-index") {
    lines.push("Status: missing exact worktree index");
  } else if (status.code === "missing-commit") {
    lines.push("Status: missing indexed commit metadata");
  } else {
    lines.push("Status: stale");
  }

  if (!status.ok && status.recommendedCommand) {
    lines.push(`Run: ${status.recommendedCommand}`);
  }
  return `${lines.join("\n")}\n`;
}

export function gitNexusStatusExitCode(status: GitNexusWorktreeStatus): number {
  if (status.code === "ok") return 0;
  if (status.code === "missing-commit") return 88;
  if (status.code === "stale") return 89;
  return 87;
}

export function runGitNexusAnalyze(input: { cwd?: string; force?: boolean; noStats?: boolean } = {}) {
  const cwd = input.cwd ?? process.cwd();
  const worktreePath = currentGitRoot(cwd);
  const cmd = [
    "npx",
    "gitnexus",
    "analyze",
    worktreePath,
    "--skip-git",
    "--name",
    basename(worktreePath),
    "--allow-duplicate-name",
    "--skip-agents-md",
  ];
  if (input.noStats) cmd.push("--no-stats");
  if (input.force) cmd.push("--force");
  return Bun.spawnSync({
    cmd,
    cwd: worktreePath,
    env: { ...process.env, PATH: gitNexusToolchainPath(worktreePath) },
    stdout: "pipe",
    stderr: "pipe",
  });
}

export function gitNexusAnalyzeCommand(worktreePath: string): string {
  return `gxpm gitnexus index`;
}

export function gitNexusToolchainPath(worktreePath: string): string {
  const parts = [join(worktreePath, ".gxpm-worktree", "bin")];
  const manager = readPackageManager(worktreePath);
  if (manager?.name === "npm") {
    const binDir = findPackageManagerBinDir(manager.name, manager.version);
    if (binDir) parts.push(binDir);
  }
  parts.push(process.env.PATH ?? "");
  return parts.filter(Boolean).join(":");
}

function findExactRegistryEntry(registryPath: string, worktreePath: string) {
  const expected = realpathSync(worktreePath);
  const entries = JSON.parse(readFileSync(registryPath, "utf8")) as GitNexusRegistryEntry[];
  return entries.find((entry) => {
    if (!entry.path) return false;
    try {
      return realpathSync(entry.path) === expected;
    } catch {
      return resolve(entry.path) === expected;
    }
  });
}

function currentGitRoot(cwd: string) {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Not inside a git worktree: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function currentGitCommit(cwd: string) {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot read current git commit: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function commitsMatch(currentCommit: string, indexedCommit: string) {
  return currentCommit === indexedCommit || currentCommit.startsWith(indexedCommit) || indexedCommit.startsWith(currentCommit);
}

function readPackageManager(root: string): { name: string; version: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { packageManager?: unknown };
    if (typeof pkg.packageManager !== "string") return undefined;
    const match = pkg.packageManager.match(/^([a-zA-Z0-9._-]+)@(.+)$/);
    if (!match) return undefined;
    return { name: match[1], version: match[2] };
  } catch {
    return undefined;
  }
}

function findPackageManagerBinDir(name: string, version: string): string | undefined {
  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, name);
    if (!existsSync(candidate)) continue;
    const result = Bun.spawnSync({
      cmd: [candidate, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0 && result.stdout.toString().trim() === version) {
      return entry;
    }
  }
  return undefined;
}
