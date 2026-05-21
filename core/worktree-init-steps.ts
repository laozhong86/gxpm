/**
 * Built-in WorktreeInitSteps for gxpm.
 *
 * Steps are registered by name and consumed by WorktreeInitPipeline.
 * Each step is self-contained and reads configuration from gxpm config.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { getResolvedConfigValue } from "./config";
import { writeWorktreeOwnerMarker, writeIssueContextMd, ensureWorktreeIdentity } from "./worktree-owner";
import {
  type WorktreeInitStep,
  type WorktreeInitContext,
  type WorktreeInitStepResult,
  type PortAllocation,
  registerBuiltinStep,
  ensureSymlink,
  setEnvVar,
  readEnvFile,
  safeWorktreeSlug,
  hashSlot,
  checkPortAvailable,
  appendGitExcludeEntry,
} from "./worktree-init";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConfigStringArray(root: string, key: string): string[] {
  const cfg = getResolvedConfigValue({ root, key });
  if (Array.isArray(cfg.value)) return cfg.value as string[];
  return [];
}

function resolveConfigString(root: string, key: string, fallback: string): string {
  const cfg = getResolvedConfigValue({ root, key });
  return typeof cfg.value === "string" ? cfg.value : fallback;
}

function resolveConfigNumber(root: string, key: string, fallback: number): number {
  const cfg = getResolvedConfigValue({ root, key });
  return typeof cfg.value === "number" ? cfg.value : fallback;
}

function warnIfNotOk(result: { ok: boolean; warning?: string }, warnings: string[]): void {
  if (!result.ok && result.warning) warnings.push(result.warning);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellDoubleQuote(value: string): string {
  return `"${value.replace(/(["\\`])/g, "\\$1")}"`;
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

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function findNodeModulesDirs(basePath: string, depth = 0): string[] {
  const results: string[] = [];
  if (depth > 10) return results;
  let entries;
  try {
    entries = readdirSync(basePath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(basePath, entry.name);
    if (entry.name === "node_modules") {
      results.push(fullPath);
      continue;
    }
    results.push(...findNodeModulesDirs(fullPath, depth + 1));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Step: symlink-node-modules
// ---------------------------------------------------------------------------

registerBuiltinStep("symlink-node-modules", () => ({
  name: "symlink-node-modules",
  run(ctx): WorktreeInitStepResult {
    const mode = resolveConfigString(ctx.canonicalRepoPath, "worktree.nodeModulesMode", "symlink");
    const warnings: string[] = [];
    const canonicalNodeModules = findNodeModulesDirs(ctx.canonicalRepoPath);

    for (const canonicalNm of canonicalNodeModules) {
      const rel = relative(ctx.canonicalRepoPath, canonicalNm);
      const worktreeNm = resolve(ctx.worktreePath, rel);

      // Skip if this is the root node_modules and mode is overlay
      if (rel === "node_modules" && mode === "overlay") {
        setupRootNodeModulesOverlay(ctx.canonicalRepoPath, ctx.worktreePath, warnings);
        continue;
      }

      let current;
      try {
        current = lstatSync(worktreeNm);
      } catch {
        current = undefined;
      }

      if (current) {
        if (current.isSymbolicLink()) {
          let pointsToCanonical = false;
          try {
            const existingTarget = resolve(ctx.worktreePath, readlinkSync(worktreeNm));
            pointsToCanonical = realpathSync(existingTarget) === realpathSync(canonicalNm);
          } catch {
            pointsToCanonical = false;
          }
          if (!pointsToCanonical) {
            try {
              rmSync(worktreeNm, { force: true });
              mkdirSync(dirname(worktreeNm), { recursive: true });
              symlinkSync(canonicalNm, worktreeNm, "dir");
              warnings.push(`Worktree ${rel} symlink pointed elsewhere; rewrote to canonical.`);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              warnings.push(`Worktree ${rel} symlink rewrite failed: ${message}`);
            }
          }
          continue;
        }
        if (current.isDirectory()) {
          warnings.push(
            `Worktree ${rel} exists as a real directory; leaving unchanged to avoid data loss.`,
          );
          continue;
        }
      }

      try {
        mkdirSync(dirname(worktreeNm), { recursive: true });
        symlinkSync(canonicalNm, worktreeNm, "dir");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to create ${rel} symlink: ${message}`);
      }
    }

    return { ok: true, warnings };
  },
}));

function setupRootNodeModulesOverlay(main: string, wt: string, warnings: string[]): void {
  const mainNm = join(main, "node_modules");
  const wtNm = join(wt, "node_modules");

  if (!existsSync(mainNm)) return;

  if (existsSync(wtNm)) {
    if (lstatSync(wtNm).isSymbolicLink()) {
      rmSync(wtNm, { force: true });
    } else if (lstatSync(wtNm).isDirectory()) {
      warnings.push("node_modules overlay conflict: real directory exists; skipping overlay");
      return;
    }
  }

  mkdirSync(join(wtNm, "@gxg"), { recursive: true });

  // Symlink .bin
  const binResult = ensureSymlink(join(mainNm, ".bin"), join(wtNm, ".bin"));
  if (!binResult.ok) warnings.push(binResult.warning ?? ".bin symlink failed");

  // Discover workspace local packages and symlink @gxg/*
  const workspaceTargets: string[] = [];
  if (existsSync(join(wt, "server"))) workspaceTargets.push(join(wt, "server"));
  if (existsSync(join(wt, "apps", "web"))) workspaceTargets.push(join(wt, "apps", "web"));
  if (existsSync(join(wt, "packages"))) {
    for (const pkgDir of readdirSync(join(wt, "packages"))) {
      const p = join(wt, "packages", pkgDir);
      if (existsSync(p) && lstatSync(p).isDirectory()) workspaceTargets.push(p);
    }
  }

  for (const target of workspaceTargets) {
    const pkgJson = join(target, "package.json");
    if (!existsSync(pkgJson)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { name?: string };
      if (typeof pkg.name === "string" && pkg.name.startsWith("@gxg/")) {
        const shortName = pkg.name.slice(5);
        const dst = join(wtNm, "@gxg", shortName);
        const r = ensureSymlink(target, dst);
        if (!r.ok) warnings.push(r.warning ?? `${pkg.name} symlink failed`);
      }
    } catch {
      // ignore parse errors
    }
  }
}

// ---------------------------------------------------------------------------
// Step: symlink-env
// ---------------------------------------------------------------------------

registerBuiltinStep("symlink-env", () => ({
  name: "symlink-env",
  run(ctx): WorktreeInitStepResult {
    const warnings: string[] = [];
    const envFiles = resolveConfigStringArray(ctx.canonicalRepoPath, "worktree.envFiles");

    for (const subpath of envFiles) {
      const src = join(ctx.canonicalRepoPath, subpath);
      const dst = join(ctx.worktreePath, subpath);
      if (!existsSync(src)) continue;
      const r = ensureSymlink(src, dst);
      warnIfNotOk(r, warnings);
    }

    return { ok: true, warnings };
  },
}));

// ---------------------------------------------------------------------------
// Step: symlink-shared-dirs
// ---------------------------------------------------------------------------

registerBuiltinStep("symlink-shared-dirs", () => ({
  name: "symlink-shared-dirs",
  run(ctx): WorktreeInitStepResult {
    const warnings: string[] = [];
    const dirs = resolveConfigStringArray(ctx.canonicalRepoPath, "worktree.sharedDirs");

    for (const subpath of dirs) {
      const src = join(ctx.canonicalRepoPath, subpath);
      const dst = join(ctx.worktreePath, subpath);
      if (!existsSync(src)) continue;
      const r = ensureSymlink(src, dst);
      warnIfNotOk(r, warnings);
    }

    return { ok: true, warnings };
  },
}));

// ---------------------------------------------------------------------------
// Step: toolchain-env
// ---------------------------------------------------------------------------

registerBuiltinStep("toolchain-env", () => ({
  name: "toolchain-env",
  run(ctx): WorktreeInitStepResult {
    const warnings: string[] = [];
    const toolchainDir = join(ctx.worktreePath, ".gxpm-worktree");
    const binDir = join(toolchainDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const manager = readPackageManager(ctx.canonicalRepoPath);
    let preferredBinDir: string | undefined;
    if (manager?.name === "npm") {
      preferredBinDir = findPackageManagerBinDir(manager.name, manager.version);
      if (!preferredBinDir) {
        warnings.push(`No npm binary matching packageManager npm@${manager.version} found on PATH.`);
      }
    } else if (manager) {
      warnings.push(`toolchain-env currently supports npm packageManager, found ${manager.name}@${manager.version}.`);
    } else {
      warnings.push("No packageManager field found in canonical package.json.");
    }

    const pathEntries = [binDir, preferredBinDir, "$PATH"].filter((entry): entry is string => Boolean(entry));
    const pathExport = preferredBinDir
      ? `export PATH=${shellDoubleQuote(pathEntries.join(":"))}`
      : `export PATH=${shellDoubleQuote(`${binDir}:$PATH`)}`;
    writeFileSync(
      join(toolchainDir, "env.sh"),
      [
        "# Generated by gxpm. Source this file before running package-manager tools in this worktree.",
        pathExport,
        `export GXPM_EXPECTED_WORKTREE_ROOT=${shellQuote(ctx.worktreePath)}`,
        "",
      ].join("\n"),
    );

    writeExecutable(
      join(binDir, "gxpm-gitnexus-status"),
      `#!/usr/bin/env bash
set -euo pipefail

expected_root="$(git rev-parse --show-toplevel)"
expected_real="$(cd "$expected_root" && pwd -P)"
registry_path="$HOME/.gitnexus/registry.json"
current_commit="$(git rev-parse HEAD)"

if [[ ! -f "$registry_path" ]]; then
  printf 'GitNexus registry missing: %s\\n' "$registry_path" >&2
  printf 'Run: npx gitnexus analyze %q --skip-git --name %q --allow-duplicate-name --skip-agents-md\\n' "$expected_real" "$(basename "$expected_real")" >&2
  exit 87
fi

set +e
record_json="$(node -e '
const fs = require("node:fs");
const path = require("node:path");
const registryPath = process.argv[1];
const expected = fs.realpathSync(process.argv[2]);
const entries = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const match = entries.find((entry) => {
  if (!entry || typeof entry.path !== "string") return false;
  try {
    return fs.realpathSync(entry.path) === expected;
  } catch {
    return path.resolve(entry.path) === expected;
  }
});
if (!match) process.exit(2);
process.stdout.write(JSON.stringify(match));
' "$registry_path" "$expected_real")"
node_status=$?
set -e

if [[ "$node_status" -eq 2 ]]; then
  printf 'GitNexus worktree index missing: %s\\n' "$expected_real" >&2
  printf 'Run: npx gitnexus analyze %q --skip-git --name %q --allow-duplicate-name --skip-agents-md\\n' "$expected_real" "$(basename "$expected_real")" >&2
  exit 87
elif [[ "$node_status" -ne 0 ]]; then
  printf 'GitNexus registry check failed for %s\\n' "$expected_real" >&2
  exit "$node_status"
fi

indexed_commit="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.lastCommit || ""));' "$record_json")"
indexed_at="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.indexedAt || ""));' "$record_json")"
files="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.stats?.files || ""));' "$record_json")"
symbols="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.stats?.nodes || ""));' "$record_json")"
edges="$(node -e 'const record = JSON.parse(process.argv[1]); process.stdout.write(String(record.stats?.edges || ""));' "$record_json")"

printf 'Repository: %s\\n' "$expected_real"
printf 'Indexed: %s\\n' "$indexed_at"
printf 'Indexed commit: %s\\n' "$indexed_commit"
printf 'Current commit: %s\\n' "$current_commit"
if [[ -n "$files" || -n "$symbols" || -n "$edges" ]]; then
  printf 'Stats: %s files, %s symbols, %s edges\\n' "$files" "$symbols" "$edges"
fi

if [[ -z "$indexed_commit" ]]; then
  printf 'Status: missing indexed commit metadata\\n' >&2
  exit 88
fi

if [[ "$current_commit" == "$indexed_commit"* || "$indexed_commit" == "$current_commit"* ]]; then
  printf 'Status: up-to-date\\n'
  exit 0
fi

printf 'Status: stale\\n' >&2
printf 'Run: npx gitnexus analyze %q --skip-git --name %q --allow-duplicate-name --skip-agents-md\\n' "$expected_real" "$(basename "$expected_real")" >&2
exit 89
`,
    );

    appendGitExcludeEntry(ctx.worktreePath, ".gxpm-worktree/");
    return { ok: true, warnings };
  },
}));

// ---------------------------------------------------------------------------
// Step: port-allocation
// ---------------------------------------------------------------------------

registerBuiltinStep("port-allocation", () => ({
  name: "port-allocation",
  run(ctx): WorktreeInitStepResult {
    const root = ctx.canonicalRepoPath;
    const maxSlot = resolveConfigNumber(root, "worktree.portSlots", 10);
    const baseWeb = resolveConfigNumber(root, "worktree.portBaseWeb", 5173);
    const baseServer = resolveConfigNumber(root, "worktree.portBaseServer", 3000);
    const baseStudio = resolveConfigNumber(root, "worktree.portBaseStudio", 4111);

    const wtName = basename(ctx.worktreePath);
    const initialSlot = hashSlot(wtName, maxSlot);

    let selectedSlot = 0;
    const ownershipErrors: string[] = [];

    for (let attempt = 0; attempt < maxSlot; attempt++) {
      const candidate = ((initialSlot + attempt - 1) % maxSlot) + 1;
      const offset = candidate * 10;
      const webPort = baseWeb + offset;
      const serverPort = baseServer + offset;
      const studioPort = baseStudio + offset;

      const webOk = checkPortAvailable(webPort, ctx.worktreePath);
      const serverOk = checkPortAvailable(serverPort, ctx.worktreePath);
      const studioOk = checkPortAvailable(studioPort, ctx.worktreePath);

      if (webOk && serverOk && studioOk) {
        selectedSlot = candidate;
        break;
      }
      if (!webOk) ownershipErrors.push(`slot ${candidate}: web port ${webPort} occupied`);
      if (!serverOk) ownershipErrors.push(`slot ${candidate}: server port ${serverPort} occupied`);
      if (!studioOk) ownershipErrors.push(`slot ${candidate}: studio port ${studioPort} occupied`);
    }

    if (selectedSlot === 0) {
      return {
        ok: false,
        error: `No available worktree port slot (checked ${maxSlot}). ${ownershipErrors.join("; ")}`,
      };
    }

    const offset = selectedSlot * 10;
    const wtPathHash = createHash("sha256").update(ctx.worktreePath).digest("hex").slice(0, 8);
    const queuePrefix = `gxpm_wt_${safeWorktreeSlug(wtName)}_${wtPathHash}_${selectedSlot}`;

    ctx.ports = {
      slot: selectedSlot,
      webPort: baseWeb + offset,
      serverPort: baseServer + offset,
      studioPort: baseStudio + offset,
      queuePrefix,
    };

    const warnings = selectedSlot !== initialSlot
      ? [`Slot ${initialSlot} occupied, fell back to slot ${selectedSlot}`]
      : undefined;

    return { ok: true, warnings };
  },
}));

// ---------------------------------------------------------------------------
// Step: generate-env-local
// ---------------------------------------------------------------------------

registerBuiltinStep("generate-env-local", () => ({
  name: "generate-env-local",
  run(ctx): WorktreeInitStepResult {
    if (!ctx.ports) {
      return { ok: false, error: "port-allocation step must run before generate-env-local" };
    }

    const root = ctx.canonicalRepoPath;
    const envLocalFiles = resolveConfigStringArray(root, "worktree.envLocalFiles");
    const warnings: string[] = [];

    // Inherit main repo .env.local values first
    for (const subpath of envLocalFiles) {
      const mainLocal = join(root, subpath);
      const wtLocal = join(ctx.worktreePath, subpath);
      if (existsSync(mainLocal)) {
        const mainVars = readEnvFile(mainLocal);
        for (const [k, v] of Object.entries(mainVars)) {
          setEnvVar(wtLocal, k, v);
        }
      }
    }

    const { webPort, serverPort, studioPort, queuePrefix } = ctx.ports;

    // Web .env.local
    const webEnvLocal = join(ctx.worktreePath, "apps", "web", ".env.local");
    setEnvVar(webEnvLocal, "VITE_DEV_PORT", String(webPort));
    setEnvVar(webEnvLocal, "VITE_API_BASE_URL", `http://127.0.0.1:${serverPort}`);

    // Server .env.local
    const serverEnvLocal = join(ctx.worktreePath, "server", ".env.local");
    setEnvVar(serverEnvLocal, "PORT", String(serverPort));
    setEnvVar(serverEnvLocal, "HOST", "0.0.0.0");
    setEnvVar(serverEnvLocal, "STUDIO_PORT", String(studioPort));
    setEnvVar(serverEnvLocal, "BULLMQ_PREFIX", queuePrefix);
    setEnvVar(serverEnvLocal, "DEV_CORS_EXTRA_ORIGINS", `http://localhost:${webPort},http://127.0.0.1:${webPort}`);

    // Git/worktree identity
    const branchResult = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: ctx.worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() : "unknown";

    const shaResult = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--short", "HEAD"],
      cwd: ctx.worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sha = shaResult.exitCode === 0 ? shaResult.stdout.toString().trim() : "unknown";

    setEnvVar(serverEnvLocal, "GIT_BRANCH", branch);
    setEnvVar(serverEnvLocal, "GIT_SHA", sha);
    setEnvVar(serverEnvLocal, "WORKTREE_NAME", basename(ctx.worktreePath));

    return { ok: true, warnings };
  },
}));

// ---------------------------------------------------------------------------
// Step: generate-warp-md
// ---------------------------------------------------------------------------

registerBuiltinStep("generate-warp-md", () => ({
  name: "generate-warp-md",
  run(ctx): WorktreeInitStepResult {
    if (!ctx.ports) {
      return { ok: false, error: "port-allocation step must run before generate-warp-md" };
    }

    const root = ctx.canonicalRepoPath;
    const warpPath = resolveConfigString(root, "worktree.warpMdPath", "warp.md");
    const dst = join(ctx.worktreePath, warpPath);

    const branchResult = Bun.spawnSync({
      cmd: ["git", "branch", "--show-current"],
      cwd: ctx.worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() : "unknown";

    const { slot, webPort, serverPort, studioPort, queuePrefix } = ctx.ports;

    const content = `# Worktree Port Configuration

This worktree (Slot ${slot}) uses isolated ports and queue prefix, separated from the main repo and other worktrees for parallel debugging.

## Port Allocation

| Service | Port | URL |
|---------|------|-----|
| Web (Vite) | ${webPort} | http://127.0.0.1:${webPort} |
| API Server | ${serverPort} | http://127.0.0.1:${serverPort} |
| Mastra Studio | ${studioPort} | http://127.0.0.1:${studioPort} (debug only, requires explicit authorization) |
| BullMQ Prefix | ${queuePrefix} | Redis queue isolation |

## Branch Baseline Traceability

| Field | Value |
|-------|-------|
| Current branch | ${branch} |
| Baseline ref | ${ctx.baseBranch ?? "unknown"} |
| Baseline sha | ${ctx.baseSha ?? "unknown"} |

## Agent Rules

- This worktree uses the ports above. **Do not** use main repo defaults (${resolveConfigNumber(root, "worktree.portBaseWeb", 5173)} / ${resolveConfigNumber(root, "worktree.portBaseServer", 3000)} / ${resolveConfigNumber(root, "worktree.portBaseStudio", 4111)}).
- Ports and queue isolation are injected via \`apps/web/.env.local\` and \`server/.env.local\`.
- Start services with \`npm run dev\` — **do not** append \`--port\`.
- Do not override PORT, VITE_DEV_PORT, STUDIO_PORT, or BULLMQ_PREFIX in .env.local.
- Report URLs using the ports in this table, not defaults.
- Do **not** start Mastra Studio without explicit user authorization.
`;

    writeFileSync(dst, content);
    return { ok: true };
  },
}));

// ---------------------------------------------------------------------------
// Step: generate-launch-json
// ---------------------------------------------------------------------------

registerBuiltinStep("generate-launch-json", () => ({
  name: "generate-launch-json",
  run(ctx): WorktreeInitStepResult {
    if (!ctx.ports) {
      return { ok: false, error: "port-allocation step must run before generate-launch-json" };
    }

    const root = ctx.canonicalRepoPath;
    const launchPath = resolveConfigString(root, "worktree.launchJsonPath", ".claude/launch.json");
    const dst = join(ctx.worktreePath, launchPath);

    const { webPort, serverPort } = ctx.ports;

    const config = {
      version: "0.0.2",
      configurations: [
        {
          name: "dev",
          runtimeExecutable: "npm",
          runtimeArgs: ["run", "dev"],
          port: webPort,
          autoPort: false,
          env: {
            PORT: String(serverPort),
          },
        },
      ],
    };

    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, JSON.stringify(config, null, 2) + "\n");

    // Exclude from git to avoid dirty state
    appendGitExcludeEntry(ctx.worktreePath, launchPath);

    return { ok: true };
  },
}));

// ---------------------------------------------------------------------------
// Step: git-hooks
// ---------------------------------------------------------------------------

registerBuiltinStep("git-hooks", () => ({
  name: "git-hooks",
  run(ctx): WorktreeInitStepResult {
    const root = ctx.canonicalRepoPath;
    const hooksScript = resolveConfigString(root, "worktree.hooksScript", "");
    if (!hooksScript) return { ok: true }; // nothing to do

    const scriptPath = join(ctx.worktreePath, hooksScript);
    if (!existsSync(scriptPath)) {
      return { ok: false, error: `hooks script not found: ${scriptPath}` };
    }

    const result = Bun.spawnSync({
      cmd: ["bash", scriptPath],
      cwd: ctx.worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr.toString().trim() || "git-hooks script failed" };
    }

    return { ok: true };
  },
}));

// ---------------------------------------------------------------------------
// Step: baseline-freshness
// ---------------------------------------------------------------------------

registerBuiltinStep("baseline-freshness", () => ({
  name: "baseline-freshness",
  run(ctx): WorktreeInitStepResult {
    const root = ctx.canonicalRepoPath;
    const baseBranch = ctx.baseBranch ?? resolveConfigString(root, "worktree.baseBranch", "main");
    const script = resolveConfigString(root, "worktree.baselineFreshnessScript", "");

    if (script) {
      const scriptPath = join(ctx.worktreePath, script);
      if (!existsSync(scriptPath)) {
        return { ok: false, error: `baseline freshness script not found: ${scriptPath}` };
      }
      const result = Bun.spawnSync({
        cmd: ["node", scriptPath, "--no-fetch"],
        cwd: ctx.worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        return {
          ok: true,
          warnings: [
            `Worktree baseline may be behind origin/${baseBranch}. Consider rebase or merge to reduce conflict cost.`,
          ],
        };
      }
      const out = result.stdout.toString();
      if (out.includes("Baseline drift detected")) {
        return {
          ok: true,
          warnings: [
            `Worktree baseline is behind origin/${baseBranch}. Early sync recommended to avoid rising conflict cost.`,
          ],
        };
      }
      return { ok: true };
    }

    // Built-in lightweight check
    try {
      const result = Bun.spawnSync({
        cmd: ["git", "merge-base", "--is-ancestor", `origin/${baseBranch}`, ctx.branchName],
        cwd: ctx.worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        return {
          ok: true,
          warnings: [
            `Worktree branch '${ctx.branchName}' is not based on '${baseBranch}'. Recreate if needed.`,
          ],
        };
      }
    } catch {
      // non-blocking
    }

    return { ok: true };
  },
}));

// ---------------------------------------------------------------------------
// Step: owner-marker
// ---------------------------------------------------------------------------

registerBuiltinStep("owner-marker", {
  name: "owner-marker",
  run(ctx): WorktreeInitStepResult {
    try {
      // GXPM-187: writes BOTH .gxpm-worktree-owner.json and ISSUE_CONTEXT.md,
      // preserves createdAt across re-runs, guards against ownerIssueId
      // conflicts, and emits a worktree.identity.written audit event so
      // bootstrap-protocol audits can prove identity was actually persisted.
      ensureWorktreeIdentity({
        repoRoot: ctx.canonicalRepoPath,
        workspacePath: ctx.worktreePath,
        issueId: ctx.issueId,
        currentPhase: "dispatch",
        branchName: ctx.branchName,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  },
});

// ---------------------------------------------------------------------------
// Step: issue-context (no-op; owner-marker now writes ISSUE_CONTEXT.md too)
// ---------------------------------------------------------------------------

registerBuiltinStep("issue-context", {
  name: "issue-context",
  run(_ctx): WorktreeInitStepResult {
    // GXPM-187: ISSUE_CONTEXT.md is now written by ensureWorktreeIdentity
    // inside the owner-marker step. This step is kept as a no-op for pipeline
    // configs that still list it by name.
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Step: dep-check (fail-fast dependency verification)
// ---------------------------------------------------------------------------

registerBuiltinStep("dep-check", () => ({
  name: "dep-check",
  run(ctx): WorktreeInitStepResult {
    const root = ctx.canonicalRepoPath;
    const warnings: string[] = [];

    // Check main repo node_modules exists
    const mainNm = join(root, "node_modules");
    if (!existsSync(mainNm)) {
      return {
        ok: false,
        error: `Main repo node_modules missing. Run 'npm install' in ${root} first.`,
      };
    }

    // Check workspace sub-dirs
    const subDirs = ["server/node_modules", "apps/web/node_modules"];
    for (const sub of subDirs) {
      const src = join(root, sub);
      const dst = join(ctx.worktreePath, sub);
      if (existsSync(src) && !existsSync(dst)) {
        const r = ensureSymlink(src, dst);
        warnIfNotOk(r, warnings);
      }
    }

    return { ok: true, warnings };
  },
}));
