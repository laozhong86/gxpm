/**
 * IsolationResolver — automated worktree reuse/create decision for gxpm issues.
 *
 * Six-layer resolution strategy:
 * 1. Existing environment reference (from issue runs or dispatch-handoff)
 * 2. No codebase = skip isolation (plain directory workspace)
 * 3. Workflow reuse (same codebase + workflow identity)
 * 4. Linked issue sharing (cross-issue workspace reuse)
 * 5. PR branch adoption (existing worktree for branch)
 * 6. Create new worktree
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyIsolationError, isKnownIsolationError } from "./isolation-errors";
import { readArtifact } from "./artifacts";
import { getIssuePaths, readIssueState } from "./state";
import { listRuns } from "./runs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IsolationEnvironment {
  issueId: string;
  workspacePath: string;
  branchName?: string;
  createdAt: string;
  status: "active" | "destroyed";
}

export type IsolationMethod =
  | { type: "existing" }
  | { type: "workflow_reuse" }
  | { type: "linked_issue_reuse"; linkedIssueId: string }
  | { type: "branch_adoption"; branch: string }
  | { type: "created" };

export interface IsolationResolution {
  status: "resolved" | "stale_cleaned" | "blocked" | "none";
  cwd: string;
  method?: IsolationMethod;
  env?: IsolationEnvironment;
  warnings?: string[];
  userMessage?: string;
  previousEnvId?: string;
  reason?: string;
}

export interface IsolationHints {
  baseBranch?: string;
  prBranch?: string;
  linkedIssues?: string[];
  workflowType?: string;
  workflowId?: string;
}

export interface ResolveIsolationInput {
  issueId: string;
  root?: string;
  hints?: IsolationHints;
  existingEnvId?: string;
}

export interface IsolationRequest {
  codebaseId: string;
  codebaseName: string;
  canonicalRepoPath: string;
  identifier: string;
  workflowType: string;
  prBranch?: string;
  fromBranch?: string;
}

export interface IsolationCreateResult {
  workingPath: string;
  branchName: string;
  warnings?: string[];
}

export interface IsolationDestroyOptions {
  canonicalRepoPath: string;
  branchName: string;
  force?: boolean;
}

/** Lightweight filesystem store backed by gxpm issue state. */
export interface IIsolationStore {
  getById(envId: string): Promise<IsolationEnvironment | undefined>;
  findActiveByWorkflow(codebaseId: string, workflowType: string, workflowId: string): Promise<IsolationEnvironment | undefined>;
  findActiveByIssueId(issueId: string): Promise<IsolationEnvironment | undefined>;
  create(data: Omit<IsolationEnvironment, "createdAt">): Promise<IsolationEnvironment>;
  updateStatus(envId: string, status: IsolationEnvironment["status"]): Promise<void>;
}

/** Provider for creating/destroying actual worktrees. */
export interface IIsolationProvider {
  create(request: IsolationRequest): Promise<IsolationCreateResult>;
  destroy(workingPath: string, options: IsolationDestroyOptions): Promise<void>;
}

export interface IsolationResolverDeps {
  store: IIsolationStore;
  provider: IIsolationProvider;
  staleThresholdDays?: number;
}

// ---------------------------------------------------------------------------
// Default filesystem store (gxpm native)
// ---------------------------------------------------------------------------

export function createFileSystemStore(root: string): IIsolationStore {
  return {
    async getById(envId: string): Promise<IsolationEnvironment | undefined> {
      try {
        const state = readIssueState({ root, issueId: envId });
        const paths = getIssuePaths(root, envId);
        const handoff = readArtifact({ root, issueId: envId, type: "dispatch-handoff" });
        const payload = (handoff.payload ?? {}) as Record<string, unknown>;
        const workspacePath =
          (payload.worktree as string) ??
          (payload.workspace as string) ??
          (payload.worktreePath as string);
        if (!workspacePath) return undefined;
        return {
          issueId: envId,
          workspacePath,
          branchName: (payload.branch as string) ?? (payload.targetBranch as string) ?? undefined,
          createdAt: state.createdAt,
          status: "active",
        };
      } catch {
        return undefined;
      }
    },

    async findActiveByWorkflow(
      _codebaseId: string,
      workflowType: string,
      workflowId: string,
    ): Promise<IsolationEnvironment | undefined> {
      // Scan all issues for matching workflow in dispatch-handoff or runs
      const issuesDir = join(root, ".gxpm", "issues");
      if (!existsSync(issuesDir)) return undefined;

      for (const entry of readdirSync(issuesDir)) {
        if (!entry.startsWith("GXPM-")) continue;
        try {
          const handoff = readArtifact({ root, issueId: entry, type: "dispatch-handoff" });
          const payload = (handoff.payload ?? {}) as Record<string, unknown>;
          const wtWorkflowType = payload.workflowType as string | undefined;
          const wtWorkflowId = payload.workflowId as string | undefined;
          if (wtWorkflowType === workflowType && wtWorkflowId === workflowId) {
            const env = await this.getById(entry);
            if (env && env.status === "active") return env;
          }
        } catch {
          // ignore missing artifacts
        }
      }
      return undefined;
    },

    async findActiveByIssueId(issueId: string): Promise<IsolationEnvironment | undefined> {
      const env = await this.getById(issueId);
      return env && env.status === "active" ? env : undefined;
    },

    async create(data: Omit<IsolationEnvironment, "createdAt">): Promise<IsolationEnvironment> {
      const env: IsolationEnvironment = { ...data, createdAt: new Date().toISOString() };
      // In filesystem store, the env is implicitly stored via dispatch-handoff
      return env;
    },

    async updateStatus(envId: string, status: IsolationEnvironment["status"]): Promise<void> {
      // Best-effort: no-op for filesystem store; caller logs if needed.
      void envId;
      void status;
    },
  };
}

// ---------------------------------------------------------------------------
// Default git provider
// ---------------------------------------------------------------------------

export function createGitProvider(): IIsolationProvider {
  return {
    async create(request: IsolationRequest): Promise<IsolationCreateResult> {
      const branchName = request.prBranch ?? `gxpm-${request.identifier}`;
      const worktreePath = join(request.canonicalRepoPath, ".gxpm", "worktrees", branchName);

      // Check if branch already exists
      const branchExists = Bun.spawnSync({
        cmd: ["git", "branch", "--list", branchName],
        cwd: request.canonicalRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (branchExists.stdout.toString().trim().includes(branchName)) {
        // Branch exists; check if worktree already exists
        const wtList = Bun.spawnSync({
          cmd: ["git", "worktree", "list", "--porcelain"],
          cwd: request.canonicalRepoPath,
          stdout: "pipe",
          stderr: "pipe",
        });
        const lines = wtList.stdout.toString().split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("worktree ")) {
            const path = lines[i].slice("worktree ".length);
            const branchLine = lines[i + 2]; // typically "branch refs/heads/..."
            if (branchLine && branchLine.includes(`refs/heads/${branchName}`)) {
              const workingPath = resolve(path);
              const warnings = [
                "Reused existing worktree for branch.",
                ...ensureSharedGxpmLink({
                  canonicalRepoPath: request.canonicalRepoPath,
                  worktreePath: workingPath,
                }),
              ];
              return { workingPath, branchName, warnings };
            }
          }
        }
      }

      // Determine base branch for worktree creation
      const baseBranch = request.fromBranch ?? "main";
      const remoteRef = `origin/${baseBranch}`;

      // Try to fetch latest remote state (best-effort; network failures are non-blocking)
      Bun.spawnSync({
        cmd: ["git", "fetch", "origin", baseBranch],
        cwd: request.canonicalRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Check if remote base branch exists
      const remoteCheck = Bun.spawnSync({
        cmd: ["git", "rev-parse", "--verify", remoteRef],
        cwd: request.canonicalRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      const hasRemote = remoteCheck.exitCode === 0;

      // Create worktree based on remote branch if available, else fall back to local HEAD
      const createResult = Bun.spawnSync({
        cmd: hasRemote
          ? ["git", "worktree", "add", "-b", branchName, "--track", worktreePath, remoteRef]
          : ["git", "worktree", "add", "-b", branchName, worktreePath],
        cwd: request.canonicalRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (createResult.exitCode !== 0) {
        const err = new Error(createResult.stderr.toString().trim());
        (err as Error & { stderr?: string }).stderr = createResult.stderr.toString().trim();
        throw err;
      }

      const warnings: string[] = [];
      if (!hasRemote) {
        warnings.push(`Remote '${remoteRef}' not found; worktree created from local HEAD.`);
      }
      warnings.push(
        ...ensureSharedGxpmLink({
          canonicalRepoPath: request.canonicalRepoPath,
          worktreePath,
        }),
      );

      return { workingPath: resolve(worktreePath), branchName, warnings };
    },

    async destroy(workingPath: string, options: IsolationDestroyOptions): Promise<void> {
      const result = Bun.spawnSync({
        cmd: ["git", "worktree", "remove", options.force ? "--force" : "", workingPath].filter(Boolean),
        cwd: options.canonicalRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString().trim());
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_DAYS = 14;

export class IsolationResolver {
  private readonly store: IIsolationStore;
  private readonly provider: IIsolationProvider;
  private readonly staleThresholdDays: number;

  constructor(deps: IsolationResolverDeps) {
    this.store = deps.store;
    this.provider = deps.provider;
    this.staleThresholdDays = deps.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS;
    if (this.staleThresholdDays <= 0) {
      throw new Error(`staleThresholdDays must be positive, got ${String(this.staleThresholdDays)}`);
    }
  }

  async resolve(input: ResolveIsolationInput): Promise<IsolationResolution> {
    const root = input.root ?? process.cwd();
    const issueId = input.issueId;
    const hints = input.hints;
    const baseBranch = hints?.baseBranch;

    // 1. Check existing isolation reference
    if (input.existingEnvId) {
      const existing = await this.checkExisting(input.existingEnvId, baseBranch);
      if (existing) return existing;
      return { status: "stale_cleaned", previousEnvId: input.existingEnvId, cwd: root };
    }

    // 2. No codebase = no isolation
    const canonicalPath = await this.getCanonicalRepoPath(root);
    if (!canonicalPath) {
      const workspacePath = join(root, ".gxpm", "local", "workspaces", issueId);
      return { status: "none", cwd: workspacePath };
    }

    const codebaseId = canonicalPath;
    const workflowType = hints?.workflowType ?? "issue";
    const workflowId = hints?.workflowId ?? issueId;

    // 3. Check for existing environment with same workflow
    const reusable = await this.findReusable(codebaseId, workflowType, workflowId, baseBranch);
    if (reusable) {
      return {
        status: "resolved",
        env: reusable.env,
        cwd: reusable.env.workspacePath,
        method: { type: "workflow_reuse" },
        ...(reusable.warnings.length > 0 ? { warnings: reusable.warnings } : {}),
      };
    }

    // 4. Check linked issues for sharing
    if (hints?.linkedIssues?.length) {
      const linked = await this.findLinkedIssueEnv(codebaseId, hints.linkedIssues);
      if (linked) return linked;
    }

    // 5. Try PR branch adoption
    if (hints?.prBranch) {
      const adopted = await this.tryBranchAdoption(codebaseId, canonicalPath, hints, workflowType, workflowId);
      if (adopted) return adopted;
    }

    // 6. Create new environment
    return this.createNewEnvironment(codebaseId, canonicalPath, workflowType, workflowId, hints);
  }

  // -------------------------------------------------------------------------
  // Layer 1: Existing
  // -------------------------------------------------------------------------
  private async checkExisting(envId: string, baseBranch?: string): Promise<IsolationResolution | null> {
    const env = await this.store.getById(envId);
    if (env && existsSync(env.workspacePath)) {
      const warnings = await this.collectBaseBranchWarnings(env, baseBranch, { envId });
      return {
        status: "resolved",
        env,
        cwd: env.workspacePath,
        method: { type: "existing" },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }
    if (env) {
      await this.markDestroyedBestEffort(env.issueId);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Layer 3: Workflow reuse
  // -------------------------------------------------------------------------
  private async findReusable(
    codebaseId: string,
    workflowType: string,
    workflowId: string,
    baseBranch?: string,
  ): Promise<{ env: IsolationEnvironment; warnings: string[] } | null> {
    const existing = await this.store.findActiveByWorkflow(codebaseId, workflowType, workflowId);
    if (!existing) return null;

    if (existsSync(existing.workspacePath)) {
      const warnings = await this.collectBaseBranchWarnings(existing, baseBranch, {
        workflowType,
        workflowId,
      });
      return { env: existing, warnings };
    }

    await this.markDestroyedBestEffort(existing.issueId);
    return null;
  }

  // -------------------------------------------------------------------------
  // Layer 4: Linked issue sharing
  // -------------------------------------------------------------------------
  private async findLinkedIssueEnv(
    codebaseId: string,
    linkedIssues: string[],
  ): Promise<IsolationResolution | null> {
    for (const linkedIssueId of linkedIssues) {
      const linkedEnv = await this.store.findActiveByIssueId(linkedIssueId);
      if (!linkedEnv) continue;

      if (existsSync(linkedEnv.workspacePath)) {
        return {
          status: "resolved",
          env: linkedEnv,
          cwd: linkedEnv.workspacePath,
          method: { type: "linked_issue_reuse", linkedIssueId },
        };
      }

      await this.markDestroyedBestEffort(linkedEnv.issueId);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Layer 5: PR branch adoption
  // -------------------------------------------------------------------------
  private async tryBranchAdoption(
    codebaseId: string,
    canonicalRepoPath: string,
    hints: IsolationHints,
    workflowType: string,
    workflowId: string,
  ): Promise<IsolationResolution | null> {
    const prBranch = hints.prBranch;
    if (!prBranch) return null;

    // Find worktree by branch
    const wtList = Bun.spawnSync({
      cmd: ["git", "worktree", "list", "--porcelain"],
      cwd: canonicalRepoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (wtList.exitCode !== 0) return null;

    const lines = wtList.stdout.toString().split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("worktree ")) {
        const path = lines[i].slice("worktree ".length);
        // Scan forward to find branch line for this worktree record
        let branchLine: string | undefined;
        for (let j = i + 1; j < lines.length && !lines[j].startsWith("worktree "); j++) {
          if (lines[j].startsWith("branch ")) {
            branchLine = lines[j];
            break;
          }
        }
        if (branchLine && branchLine.includes(`refs/heads/${prBranch}`)) {
          if (existsSync(path)) {
            const workingPath = resolve(path);
            const env = await this.store.create({
              issueId: workflowId,
              workspacePath: workingPath,
              branchName: prBranch,
              status: "active",
            });
            const warnings = ensureSharedGxpmLink({
              canonicalRepoPath,
              worktreePath: workingPath,
            });
            return {
              status: "resolved",
              env,
              cwd: env.workspacePath,
              method: { type: "branch_adoption", branch: prBranch },
              ...(warnings.length > 0 ? { warnings } : {}),
            };
          }
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Layer 6: Create new
  // -------------------------------------------------------------------------
  private async createNewEnvironment(
    codebaseId: string,
    canonicalRepoPath: string,
    workflowType: string,
    workflowId: string,
    hints: IsolationHints | undefined,
  ): Promise<IsolationResolution> {
    const request: IsolationRequest = {
      codebaseId,
      codebaseName: codebaseId.split("/").pop() ?? "repo",
      canonicalRepoPath,
      identifier: workflowId,
      workflowType,
      prBranch: hints?.prBranch,
      fromBranch: hints?.baseBranch,
    };

    let isolatedEnv: IsolationCreateResult;
    try {
      isolatedEnv = await this.provider.create(request);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!isKnownIsolationError(err)) {
        throw err;
      }
      const userMessage = classifyIsolationError(err);
      return {
        status: "blocked",
        reason: "creation_failed",
        userMessage: `${userMessage} Execution blocked to prevent changes to shared codebase. Please resolve the issue and try again.`,
        cwd: canonicalRepoPath,
      };
    }

    let env: IsolationEnvironment;
    try {
      env = await this.store.create({
        issueId: workflowId,
        workspacePath: isolatedEnv.workingPath,
        branchName: isolatedEnv.branchName,
        status: "active",
      });
    } catch (storeError) {
      const err = storeError instanceof Error ? storeError : new Error(String(storeError));
      // Clean up orphaned worktree — best-effort
      try {
        await this.provider.destroy(isolatedEnv.workingPath, {
          canonicalRepoPath,
          branchName: isolatedEnv.branchName,
          force: true,
        });
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }

    return {
      status: "resolved",
      env,
      cwd: env.workspacePath,
      method: { type: "created" },
      ...(isolatedEnv.warnings?.length ? { warnings: isolatedEnv.warnings } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async collectBaseBranchWarnings(
    env: IsolationEnvironment,
    baseBranch: string | undefined,
    _logContext: Record<string, unknown>,
  ): Promise<string[]> {
    if (!baseBranch || !env.branchName) return [];
    try {
      const result = Bun.spawnSync({
        cmd: ["git", "merge-base", "--is-ancestor", `origin/${baseBranch}`, env.branchName],
        cwd: env.workspacePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        return [
          `Worktree branch '${env.branchName}' is not based on '${baseBranch}'. ` +
            `Recreate with: gxpm cleanup land ${env.issueId} --force && retry.`,
        ];
      }
    } catch {
      // non-blocking
    }
    return [];
  }

  private async markDestroyedBestEffort(envId: string): Promise<void> {
    try {
      await this.store.updateStatus(envId, "destroyed");
    } catch {
      // ignore
    }
  }

  private async getCanonicalRepoPath(cwd: string): Promise<string | undefined> {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--show-toplevel"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    const path = result.stdout.toString().trim();
    return path || undefined;
  }
}

export function ensureSharedGxpmLink(input: {
  canonicalRepoPath: string;
  worktreePath: string;
}): string[] {
  const linkPath = resolve(input.worktreePath, ".gxpm");
  const warnings: string[] = [];

  if (resolve(input.canonicalRepoPath) === resolve(input.worktreePath)) {
    return warnings;
  }

  const canonicalGxpmPath = resolveCanonicalGxpmPath(input.canonicalRepoPath);

  let current: ReturnType<typeof lstatSync> | undefined;
  try {
    current = lstatSync(linkPath);
  } catch {
    current = undefined;
  }

  if (current) {
    if (!current.isSymbolicLink()) {
      warnings.push(`Worktree .gxpm exists and is not a symlink; leaving unchanged: ${linkPath}`);
      return warnings;
    }

    const existingTarget = resolve(input.worktreePath, readlinkSync(linkPath));
    let pointsToCanonical = false;
    try {
      pointsToCanonical = realpathSync(existingTarget) === realpathSync(canonicalGxpmPath);
    } catch {
      pointsToCanonical = false;
    }
    if (!pointsToCanonical) {
      warnings.push(
        `Worktree .gxpm symlink points to ${existingTarget}; expected ${canonicalGxpmPath}; leaving unchanged.`,
      );
    }
    return warnings;
  }

  symlinkSync(canonicalGxpmPath, linkPath, "dir");
  return warnings;
}

function resolveCanonicalGxpmPath(canonicalRepoPath: string): string {
  const statePath = resolve(canonicalRepoPath, ".gxpm");
  mkdirSync(statePath, { recursive: true });
  return realpathSync(statePath);
}
