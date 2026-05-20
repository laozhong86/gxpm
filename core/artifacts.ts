import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  appendIssueEvent,
  buildOwnershipChangedEvent,
  getIssuePaths,
  readIssueState,
  touchIssueOwnership,
  type StateEvent,
} from "./state";
import { resolveSessionId } from "./session";
import { getWorkflowEventEmitter } from "./workflow-event-emitter";

export const ARTIFACT_TYPES = [
  "issue-intake",
  "triage-report",
  "autopilot-grant",
  "acceptance-contract",
  "implementation-plan",
  "dispatch-handoff",
  "behavior-spec",
  "wiki-context",
  "local-verify",
  "acceptance-check",
  "self-review",
  "review-report",
  "cleanup-report",
  "ship-readiness",
  "ship-audit-report",
  "pr-check",
  "verify-findings",
  "qa-findings",
  "land-findings",
  "feedback-description",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface ArtifactRecord {
  schemaVersion: 1;
  type: ArtifactType;
  path: string;
  writtenAt: string;
}

export interface StoredArtifact {
  schemaVersion: 1;
  issueId: string;
  type: ArtifactType;
  writtenAt: string;
  payload: unknown;
}

interface ArtifactInput {
  root?: string;
  issueId: string;
}

interface WriteArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
  payload: unknown;
}

interface RewriteArtifactInput extends WriteArtifactInput {
  timestamp?: string;
  event?: StateEvent;
}

interface ReadArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
}

/**
 * GXPM-174: prefer the issue's full worktree-scope diff over the index-only
 * diff. Three-dot 'baseRef...HEAD' covers both committed work and unstaged
 * edits since the worktree's dispatch point. Falls back to plain 'HEAD' diff
 * when no baseline can be resolved (preserves legacy behavior).
 */
function resolveWorktreeBaselineRef(worktreeRoot: string): string | null {
  try {
    const ownerPath = join(worktreeRoot, ".gxpm-worktree-owner.json");
    if (existsSync(ownerPath)) {
      const raw = JSON.parse(readFileSync(ownerPath, "utf-8")) as { baselineRef?: string };
      if (typeof raw.baselineRef === "string" && raw.baselineRef.length > 0) {
        return raw.baselineRef;
      }
    }
  } catch {
    // ignore — fall through
  }
  // Default heuristic: prefer origin/main when reachable.
  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--verify", "origin/main"],
      cwd: worktreeRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0 && result.stdout.toString().trim().length > 0) {
      return "origin/main";
    }
  } catch {
    // ignore
  }
  return null;
}

function getGitDiffFiles(worktreeRoot: string): string[] {
  const baseRef = resolveWorktreeBaselineRef(worktreeRoot);
  const cmd = baseRef
    ? ["git", "diff", "--name-only", `${baseRef}...HEAD`]
    : ["git", "diff", "--name-only", "HEAD"];
  try {
    const result = Bun.spawnSync({
      cmd,
      cwd: worktreeRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      // baseRef resolution may have stale ref; fall back to plain HEAD diff
      if (baseRef) {
        const fallback = Bun.spawnSync({
          cmd: ["git", "diff", "--name-only", "HEAD"],
          cwd: worktreeRoot,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (fallback.exitCode !== 0) return [];
        return fallback.stdout
          .toString()
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }
      return [];
    }
    return result.stdout
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function validateLocalVerifyPayload(
  payload: unknown,
  worktreeRoot: string,
  now: string,
): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;
  const changedFiles = Array.isArray(p.changedFiles) ? (p.changedFiles as string[]) : [];
  if (changedFiles.length === 0) return payload;

  const gitDiffFiles = getGitDiffFiles(worktreeRoot);
  if (gitDiffFiles.length === 0) return payload;

  const gitSet = new Set(gitDiffFiles);
  const extraneous = changedFiles.filter((f) => !gitSet.has(f));
  if (extraneous.length === 0) return payload;

  const log = Array.isArray(p.verificationLog) ? [...p.verificationLog] : [];
  log.push(`[${now}] SCOPE_DRIFT_WARNING: changedFiles contains ${extraneous.length} file(s) not in git diff: ${extraneous.join(", ")}`);
  return { ...p, verificationLog: log };
}

export function writeArtifact(input: WriteArtifactInput): ArtifactRecord {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });

  const now = new Date().toISOString();
  const sessionId = resolveSessionId();
  const relativePath = `artifacts/${type}.json`;

  let payload = input.payload;
  if (type === "local-verify") {
    const worktreeRoot = resolve(root, ".gxpm", "worktrees", `gxpm-${input.issueId}`);
    payload = validateLocalVerifyPayload(payload, worktreeRoot, now);
  }

  const artifact: StoredArtifact = {
    schemaVersion: 1,
    issueId: input.issueId,
    type,
    writtenAt: now,
    payload,
  };
  writeFileSync(join(paths.issueDir, relativePath), `${JSON.stringify(artifact, null, 2)}\n`);

  const record: ArtifactRecord = {
    schemaVersion: 1,
    type,
    path: relativePath,
    writtenAt: now,
  };
  writeArtifactIndex(
    paths.artifactIndexPath,
    input.issueId,
    upsertRecord(listArtifacts({ root, issueId: input.issueId }), record),
  );
  const nextState = touchIssueOwnership({
    state: { ...state, updatedAt: now },
    sessionId,
  });
  if (JSON.stringify(nextState) !== JSON.stringify(state)) {
    writeFileSync(paths.statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  }
  const ownershipEvent = buildOwnershipChangedEvent({
    issueId: input.issueId,
    timestamp: now,
    previousState: state,
    nextState,
    sessionId,
  });
  if (ownershipEvent) {
    appendIssueEvent({ issueDir: paths.issueDir, event: ownershipEvent });
  }
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: artifactWrittenEvent(input.issueId, type, now, relativePath, sessionId),
  });

  getWorkflowEventEmitter().emit({
    type: "artifact_written",
    issueId: input.issueId,
    artifactType: type,
    timestamp: now,
  });

  // Fire-and-forget sync to external issue tracker
  import("./issue-sync")
    .then(({ maybeSyncIssue }) =>
      maybeSyncIssue({
        root,
        issueId: input.issueId,
        action: "artifact-written",
        meta: { artifactType: type },
      }),
    )
    .catch(() => {
      // Silently fail — local state is truth
    });

  return record;
}

export function rewriteArtifact(input: RewriteArtifactInput): ArtifactRecord {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  readIssueState({ root, issueId: input.issueId });

  const artifactPath = join(paths.issueDir, "artifacts", `${type}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${type}`);
  }

  const now = input.timestamp ?? new Date().toISOString();
  const relativePath = `artifacts/${type}.json`;
  const artifact: StoredArtifact = {
    schemaVersion: 1,
    issueId: input.issueId,
    type,
    writtenAt: now,
    payload: input.payload,
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const record: ArtifactRecord = {
    schemaVersion: 1,
    type,
    path: relativePath,
    writtenAt: now,
  };
  writeArtifactIndex(
    paths.artifactIndexPath,
    input.issueId,
    upsertRecord(listArtifacts({ root, issueId: input.issueId }), record),
  );
  if (input.event) {
    appendIssueEvent({ issueDir: paths.issueDir, event: input.event });
  }

  return record;
}

export function readArtifact(input: ReadArtifactInput): StoredArtifact {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  const artifactPath = join(paths.issueDir, "artifacts", `${type}.json`);

  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${type}`);
  }

  return JSON.parse(readFileSync(artifactPath, "utf8")) as StoredArtifact;
}

export function listArtifacts(input: ArtifactInput): ArtifactRecord[] {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);

  if (!existsSync(paths.artifactIndexPath)) {
    throw new Error(`Artifact index not found: ${input.issueId}`);
  }

  const index = JSON.parse(readFileSync(paths.artifactIndexPath, "utf8")) as {
    artifacts?: ArtifactRecord[];
  };
  return Array.isArray(index.artifacts) ? index.artifacts : [];
}

export function hasArtifact(input: ReadArtifactInput): boolean {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  return existsSync(join(paths.issueDir, "artifacts", `${type}.json`));
}

function writeArtifactIndex(path: string, issueId: string, artifacts: ArtifactRecord[]) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        issueId,
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
}

function upsertRecord(records: ArtifactRecord[], record: ArtifactRecord) {
  return [...records.filter((item) => item.type !== record.type), record].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}

function artifactWrittenEvent(
  issueId: string,
  artifactType: ArtifactType,
  timestamp: string,
  path: string,
  sessionId: string,
): StateEvent {
  return {
    schemaVersion: 1,
    type: "artifact.written",
    issueId,
    timestamp,
    sessionId,
    payload: { artifactType, path },
  };
}

function assertValidArtifactType(value: string): ArtifactType {
  if (!ARTIFACT_TYPES.includes(value as ArtifactType)) {
    throw new Error(`Invalid artifact type: ${value}`);
  }
  return value as ArtifactType;
}
