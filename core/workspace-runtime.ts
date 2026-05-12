import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getResolvedConfigValue } from "./config";
import { resolveDevPort } from "./port-allocation";
import { readIssueState } from "./state";
import {
  IsolationResolver,
  createFileSystemStore,
  createGitProvider,
  type IsolationHints,
  type IsolationMethod,
  type IsolationResolution,
} from "./isolation-resolver";

export interface WorkspacePlanInput {
  root?: string;
  issueId: string;
  workspaceRoot?: string;
}

export interface WorkspacePlan {
  issueId: string;
  workspaceKey: string;
  workspaceRoot: string;
  workspacePath: string;
  exists: boolean;
  devPort: number;
}

export interface WorkspaceEnsureResult extends WorkspacePlan {
  created: boolean;
}

export interface WorkspaceIsolationResult extends WorkspaceEnsureResult {
  method?: IsolationMethod;
  warnings?: string[];
  userMessage?: string;
  resolution?: IsolationResolution;
}

export interface WorkspaceCleanupResult extends WorkspacePlan {
  removed: boolean;
}

export function planIssueWorkspace(input: WorkspacePlanInput): WorkspacePlan {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  const workspaceRoot = resolveWorkspaceRoot({ root, workspaceRoot: input.workspaceRoot });
  const workspaceKey = sanitizeWorkspaceKey(state.issueId);
  const workspacePath = join(workspaceRoot, workspaceKey);
  assertPathInsideRoot(workspaceRoot, workspacePath);

  const plan = {
    issueId: state.issueId,
    workspaceKey,
    workspaceRoot,
    workspacePath,
    exists: existsSync(workspacePath),
  };

  return {
    ...plan,
    devPort: resolveDevPort({ workspacePath, root }),
  };
}

export function ensureIssueWorkspace(input: WorkspacePlanInput): WorkspaceEnsureResult {
  const plan = planIssueWorkspace(input);
  mkdirSync(plan.workspaceRoot, { recursive: true });
  assertPathInsideRoot(plan.workspaceRoot, plan.workspacePath);

  const existed = existsSync(plan.workspacePath);
  if (existed && !lstatSync(plan.workspacePath).isDirectory()) {
    throw new Error(`Workspace path exists but is not a directory: ${plan.workspacePath}`);
  }
  if (!existed) {
    mkdirSync(plan.workspacePath, { recursive: true });
  }

  return { ...plan, exists: true, created: !existed };
}

export async function ensureIssueWorkspaceWithResolver(
  input: WorkspacePlanInput & { hints?: IsolationHints },
): Promise<WorkspaceIsolationResult> {
  const root = input.root ?? process.cwd();
  const issueId = input.issueId;
  const configuredBaseBranch = String(getResolvedConfigValue({ root, key: "worktree.baseBranch" }).value);
  const hints: IsolationHints = {
    ...input.hints,
    baseBranch: input.hints?.baseBranch ?? configuredBaseBranch,
  };

  // Run resolver first
  const store = createFileSystemStore(root);
  const provider = createGitProvider();
  const resolver = new IsolationResolver({ store, provider });
  const resolution = await resolver.resolve({ issueId, root, hints });

  let plan: WorkspacePlan;
  let created = false;

  if (resolution.status === "resolved" && resolution.env) {
    // Use the resolved workspace path
    const workspacePath = resolution.env.workspacePath;
    const workspaceRoot = resolveWorkspaceRoot({ root, workspaceRoot: input.workspaceRoot });
    plan = {
      issueId,
      workspaceKey: sanitizeWorkspaceKey(issueId),
      workspaceRoot,
      workspacePath,
      exists: existsSync(workspacePath),
      devPort: resolveDevPort({ workspacePath, root }),
    };
    if (!plan.exists) {
      mkdirSync(workspacePath, { recursive: true });
      created = true;
    }
  } else if (resolution.status === "none") {
    // No git repo: fall back to plain directory workspace
    plan = planIssueWorkspace(input);
    mkdirSync(plan.workspaceRoot, { recursive: true });
    assertPathInsideRoot(plan.workspaceRoot, plan.workspacePath);
    const existed = existsSync(plan.workspacePath);
    if (!existed) {
      mkdirSync(plan.workspacePath, { recursive: true });
      created = true;
    }
  } else {
    // blocked or stale_cleaned — return as-is with minimal plan
    plan = planIssueWorkspace(input);
  }

  return {
    ...plan,
    exists: true,
    created,
    method: resolution.method,
    warnings: resolution.warnings,
    userMessage: resolution.userMessage,
    resolution,
  };
}

export function cleanupIssueWorkspace(input: WorkspacePlanInput): WorkspaceCleanupResult {
  const plan = planIssueWorkspace(input);
  if (!plan.exists) {
    return { ...plan, removed: false };
  }
  if (!lstatSync(plan.workspacePath).isDirectory()) {
    throw new Error(`Workspace path exists but is not a directory: ${plan.workspacePath}`);
  }
  assertPathInsideRoot(plan.workspaceRoot, plan.workspacePath);
  rmSync(plan.workspacePath, { recursive: true, force: true });
  return { ...plan, exists: false, removed: true };
}

export function sanitizeWorkspaceKey(identifier: string) {
  const safe = identifier.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || "issue";
}

export function isPathInsideRoot(
  root: string,
  candidate: string,
  pathApi = { isAbsolute, relative, resolve },
) {
  const relativePath = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return relativePath === "" || (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath));
}

function resolveWorkspaceRoot(input: { root: string; workspaceRoot?: string }) {
  const configured =
    input.workspaceRoot ??
    String(getResolvedConfigValue({ root: input.root, key: "workspace.root" }).value);
  const expanded = expandHome(configured);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(input.root, expanded);
}

function expandHome(path: string) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function assertPathInsideRoot(root: string, candidate: string) {
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error(`Workspace path escapes workspace root: ${resolve(candidate)}`);
  }
}
