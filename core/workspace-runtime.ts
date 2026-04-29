import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getResolvedConfigValue } from "./config";
import { readIssueState } from "./state";

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
}

export interface WorkspaceEnsureResult extends WorkspacePlan {
  created: boolean;
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

  return {
    issueId: state.issueId,
    workspaceKey,
    workspaceRoot,
    workspacePath,
    exists: existsSync(workspacePath),
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
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rootPrefix = resolvedRoot.endsWith("/") ? resolvedRoot : `${resolvedRoot}/`;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(rootPrefix)) {
    throw new Error(`Workspace path escapes workspace root: ${resolvedCandidate}`);
  }
}
