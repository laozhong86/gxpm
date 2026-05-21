/**
 * WorktreeInitPipeline — pluggable initialization for gxpm-managed worktrees.
 *
 * Problem: gxpm creates worktrees via IsolationResolver but only does minimal
 * post-creation setup (.gxpm symlink, node_modules symlink, owner marker).
 * Real projects (Gxgen, etc.) need much richer initialization:
 *   - node_modules overlay mode
 *   - .env symlinks + .env.local generation
 *   - multi-service port allocation with occupancy checks
 *   - warp.md / launch.json generation
 *   - git hooks, tool indexes, baseline freshness checks
 *
 * Solution: a configurable pipeline of InitSteps. Projects opt-in via
 * `.gxpm/config.json` `worktree.initSteps`. Each step is self-contained,
 * reads its own configuration from the gxpm config registry, and reports
 * warnings/errors without blocking the pipeline unless configured to do so.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getResolvedConfigValue } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortAllocation {
  slot: number;
  webPort: number;
  serverPort: number;
  studioPort: number;
  queuePrefix: string;
}

export interface WorktreeInitContext {
  /** Absolute path to the canonical (main) repo checkout. */
  canonicalRepoPath: string;
  /** Absolute path to the worktree being initialized. */
  worktreePath: string;
  /** Git branch name for the worktree. */
  branchName: string;
  /** gxpm issue id. */
  issueId: string;
  /** Base branch used to create the worktree (if known). */
  baseBranch?: string;
  /** Base commit SHA used to create the worktree (if known). */
  baseSha?: string;
  /** Populated by the port-allocation step for downstream consumers. */
  ports?: PortAllocation;
}

export interface WorktreeInitStepResult {
  ok: boolean;
  warnings?: string[];
  error?: string;
}

export interface WorktreeInitStep {
  name: string;
  run(ctx: WorktreeInitContext): Promise<WorktreeInitStepResult> | WorktreeInitStepResult;
}

export interface WorktreeInitPipelineResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  stepsRun: string[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class WorktreeInitPipeline {
  private steps: WorktreeInitStep[] = [];

  add(step: WorktreeInitStep): this {
    this.steps.push(step);
    return this;
  }

  async run(ctx: WorktreeInitContext): Promise<WorktreeInitPipelineResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const stepsRun: string[] = [];

    for (const step of this.steps) {
      try {
        const result = await step.run(ctx);
        stepsRun.push(step.name);
        if (result.warnings) warnings.push(...result.warnings);
        if (!result.ok) {
          if (result.error) errors.push(`[${step.name}] ${result.error}`);
          else errors.push(`[${step.name}] failed`);
        }
      } catch (err) {
        stepsRun.push(step.name);
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`[${step.name}] ${message}`);
      }
    }

    return { ok: errors.length === 0, warnings, errors, stepsRun };
  }
}

// ---------------------------------------------------------------------------
// Built-in step registry
// ---------------------------------------------------------------------------

const BUILTIN_STEPS: Record<string, (() => WorktreeInitStep) | WorktreeInitStep> = {};

export function registerBuiltinStep(name: string, step: (() => WorktreeInitStep) | WorktreeInitStep): void {
  BUILTIN_STEPS[name] = step;
}

export function getBuiltinStepNames(): string[] {
  return Object.keys(BUILTIN_STEPS);
}

export function resolveStep(name: string): WorktreeInitStep | undefined {
  const entry = BUILTIN_STEPS[name];
  if (!entry) return undefined;
  return typeof entry === "function" ? entry() : entry;
}

// ---------------------------------------------------------------------------
// Pipeline factory
// ---------------------------------------------------------------------------

export interface CreatePipelineInput {
  /** Explicit step names; if omitted reads from config. */
  steps?: string[];
  root?: string;
}

export function createPipeline(input: CreatePipelineInput = {}): WorktreeInitPipeline {
  const root = input.root ?? process.cwd();
  const stepNames =
    input.steps ??
    (() => {
      const cfg = getResolvedConfigValue({ root, key: "worktree.initSteps" });
      return Array.isArray(cfg.value) ? (cfg.value as string[]) : ["toolchain-env", "owner-marker", "issue-context"];
    })();

  const pipeline = new WorktreeInitPipeline();
  for (const name of stepNames) {
    const step = resolveStep(name);
    if (step) {
      pipeline.add(step);
    } else {
      // Unknown step: inject a no-op that warns
      pipeline.add({
        name: `unknown:${name}`,
        run: () => ({
          ok: false,
          warnings: [`Unknown worktree init step "${name}". Available: ${getBuiltinStepNames().join(", ")}`],
        }),
      });
    }
  }
  return pipeline;
}

// ---------------------------------------------------------------------------
// High-level runner
// ---------------------------------------------------------------------------

export async function runWorktreeInit(
  ctx: WorktreeInitContext,
  input?: CreatePipelineInput,
): Promise<WorktreeInitPipelineResult> {
  const pipeline = createPipeline(input);
  return pipeline.run(ctx);
}

// ---------------------------------------------------------------------------
// Shared helpers used by multiple steps
// ---------------------------------------------------------------------------

export function ensureSymlink(src: string, dst: string): { ok: boolean; warning?: string } {
  if (resolve(src) === resolve(dst)) return { ok: true };

  if (existsSync(dst)) {
    const stat = lstatSync(dst);
    if (stat.isSymbolicLink()) {
      try {
        const current = readlinkSync(dst);
        if (resolve(dst, current) === resolve(src) || realpathSync(resolve(dst, current)) === realpathSync(src)) {
          return { ok: true };
        }
        rmSync(dst, { force: true });
      } catch {
        rmSync(dst, { force: true });
      }
    } else {
      return { ok: false, warning: `overlay conflict: ${dst} exists as real file/directory; skipped` };
    }
  }

  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst, "dir");
  return { ok: true };
}

export function setEnvVar(filePath: string, key: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    // file does not exist yet
  }

  const lines = content.split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(filePath, lines.join("\n").replace(/\n+$/, "") + "\n");
}

export function readEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

export function safeWorktreeSlug(raw: string): string {
  let slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48);
  if (!slug) {
    slug = String(createHash("sha256").update(raw).digest("hex").slice(0, 8));
  }
  return slug;
}

export function hashSlot(input: string, maxSlot: number): number {
  const hash = createHash("sha256").update(input).digest();
  return (hash.readUInt32BE(0) % maxSlot) + 1; // 1-based
}

export function checkPortAvailable(port: number, worktreePath: string): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ["lsof", "-nP", "-iTCP:" + String(port), "-sTCP:LISTEN"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return true; // lsof found nothing

    const output = result.stdout.toString().trim();
    if (!output) return true;

    // Parse PIDs and check if they belong to this worktree
    const lines = output.split("\n").slice(1); // skip header
    for (const line of lines) {
      const pid = line.trim().split(/\s+/)[1];
      if (!pid) continue;
      try {
        const cwdResult = Bun.spawnSync({
          cmd: ["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"],
          stdout: "pipe",
          stderr: "pipe",
        });
        if (cwdResult.exitCode === 0) {
          const cwdLine = cwdResult.stdout.toString().split("\n").find((l) => l.startsWith("n"));
          const cwd = cwdLine ? cwdLine.slice(1) : "";
          if (cwd === worktreePath || cwd.startsWith(worktreePath + "/")) {
            continue; // belongs to this worktree, that's fine
          }
        }
      } catch {
        // ignore lsof failure
      }
      return false; // someone else owns this port
    }
    return true;
  } catch {
    // lsof not available → assume available (best-effort)
    return true;
  }
}

export function appendGitExcludeEntry(repoRoot: string, entry: string): void {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--git-path", "info/exclude"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return;
    const excludeFile = result.stdout.toString().trim();
    if (!excludeFile) return;
    mkdirSync(dirname(excludeFile), { recursive: true });
    let content = "";
    try {
      content = readFileSync(excludeFile, "utf8");
    } catch {
      // file may not exist
    }
    if (!content.split("\n").includes(entry)) {
      writeFileSync(excludeFile, (content ? content.replace(/\n+$/, "") + "\n" : "") + entry + "\n");
    }
  } catch {
    // best-effort
  }
}
