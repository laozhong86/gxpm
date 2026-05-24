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
  // GXPM-188: structured phase-handoff dump emitted by
  // `gxpm issue handoff <id> --to-next-phase` for the next-phase agent.
  "phase-handoff",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface ArtifactRecord {
  schemaVersion: 1;
  type: ArtifactType;
  path: string;
  writtenAt: string;
}

/**
 * GXPM-172: provenance metadata auto-stamped on every artifact write.
 * Reviewers and the contamination gate use this to trace which session/
 * host/worktree produced a given artifact.
 */
export interface ArtifactProvenance {
  sessionId: string;
  host: string;
  worktreePath?: string;
  baselineSha?: string;
}

/**
 * GXPM-176: a new artifact can declare which contaminated archive(s) it
 * supersedes. The contamination gate (in core/state.ts) reads the union of
 * these records across artifacts/ and releases when every contaminated
 * archive is covered. Reason is required to prevent silent bypass.
 */
export interface SupersedeRecord {
  contaminatedArchive: string;
  reason: string;
  supersededAt: string;
}

export interface StoredArtifact {
  schemaVersion: 1;
  issueId: string;
  type: ArtifactType;
  writtenAt: string;
  payload: unknown;
  /** GXPM-172: optional; older artifacts may lack this field. */
  provenance?: ArtifactProvenance;
  /** GXPM-176: optional; older artifacts lack this field and never cover anything. */
  supersedes?: SupersedeRecord[];
}

interface ArtifactInput {
  root?: string;
  issueId: string;
}

interface WriteArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
  payload: unknown;
  /** GXPM-176: optional supersedes declarations attached to this artifact. */
  supersedes?: SupersedeRecord[];
}

interface RewriteArtifactInput extends WriteArtifactInput {
  timestamp?: string;
  event?: StateEvent;
}

interface ReadArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
}

/**
 * GXPM-172: build provenance metadata for an artifact write. Sources that fail
 * to resolve degrade silently — provenance is observational, never gating.
 */
function buildArtifactProvenance(
  root: string,
  issueId: string,
  sessionId: string,
): ArtifactProvenance {
  const host = sessionId.split(":")[0] ?? "unknown";
  const provenance: ArtifactProvenance = { sessionId, host };

  try {
    const ownerPath = join(root, ".gxpm-worktree-owner.json");
    if (existsSync(ownerPath)) {
      const raw = JSON.parse(readFileSync(ownerPath, "utf-8")) as {
        workspacePath?: string;
        ownerIssueId?: string;
      };
      if (raw.workspacePath && (!raw.ownerIssueId || raw.ownerIssueId === issueId)) {
        provenance.worktreePath = raw.workspacePath;
      }
    }
  } catch {
    // ignore — observational
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "HEAD"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const sha = result.stdout.toString().trim();
      if (sha) provenance.baselineSha = sha;
    }
  } catch {
    // ignore — non-git root
  }

  return provenance;
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

  // GXPM-189 PR-1: telemetry-only identity-read middleware. If the current
  // session has not yet read issue context / worktree identity for this issue,
  // emit identity.read.missing before the write proceeds. Warn-only; never
  // blocks. GXPM_IDENTITY_GATE=strict is reserved for PR-2.
  emitIdentityReadMissingIfNeeded({
    issueDir: paths.issueDir,
    issueId: input.issueId,
    sessionId,
    timestamp: now,
    phase: state.currentPhase,
    artifactType: type,
  });

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
    provenance: buildArtifactProvenance(root, input.issueId, sessionId),
    ...(input.supersedes && input.supersedes.length > 0 ? { supersedes: input.supersedes } : {}),
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
  // GXPM-172: every artifact write — including rewrites — must carry
  // provenance so the contamination gate and audit trail keep their
  // session/host/worktree/baselineSha record after reconcile/edit flows.
  const sessionId = resolveSessionId();

  const artifactPath = join(paths.issueDir, "artifacts", `${type}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${type}`);
  }
  const previous = JSON.parse(readFileSync(artifactPath, "utf8")) as StoredArtifact;

  const now = input.timestamp ?? new Date().toISOString();
  const relativePath = `artifacts/${type}.json`;

  let payload = input.payload;
  if (type === "local-verify") {
    const worktreeRoot = resolve(root, ".gxpm", "worktrees", `gxpm-${input.issueId}`);
    payload = validateLocalVerifyPayload(payload, worktreeRoot, now);
  }

  const supersedes =
    input.supersedes && input.supersedes.length > 0 ? input.supersedes : previous.supersedes;

  const artifact: StoredArtifact = {
    schemaVersion: 1,
    issueId: input.issueId,
    type,
    writtenAt: now,
    payload,
    provenance: buildArtifactProvenance(root, input.issueId, sessionId),
    ...(supersedes && supersedes.length > 0 ? { supersedes } : {}),
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

// GXPM-189 PR-1: walk events.jsonl, check current sessionId for any
// issue.context.read / worktree.identity.read entry. If absent, append one
// identity.read.missing event. Telemetry-only — never throws or blocks. The
// strict-gate behavior is reserved for PR-2 via GXPM_IDENTITY_GATE=strict.
// feedback-description writes are exempt (matches GXPM-141 anchor exemption).
const IDENTITY_READ_TYPES = new Set(["issue.context.read", "worktree.identity.read"]);
const IDENTITY_EXEMPT_ARTIFACTS = new Set(["feedback-description"]);

function emitIdentityReadMissingIfNeeded(input: {
  issueDir: string;
  issueId: string;
  sessionId: string;
  timestamp: string;
  phase: string;
  artifactType: string;
}): void {
  if (IDENTITY_EXEMPT_ARTIFACTS.has(input.artifactType)) return;
  const eventsPath = join(input.issueDir, "events.jsonl");
  if (!existsSync(eventsPath)) return;
  let hasIdentityRead = false;
  try {
    for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
      if (!line) continue;
      const parsed = JSON.parse(line) as { type?: string; sessionId?: string };
      if (parsed.sessionId !== input.sessionId) continue;
      if (parsed.type && IDENTITY_READ_TYPES.has(parsed.type)) {
        hasIdentityRead = true;
        break;
      }
    }
  } catch {
    // best-effort scan; on parse error, assume missing and let event fire.
  }
  if (hasIdentityRead) return;
  try {
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "identity.read.missing",
        issueId: input.issueId,
        timestamp: input.timestamp,
        sessionId: input.sessionId,
        payload: {
          phase: input.phase,
          artifactType: input.artifactType,
          cwd: process.cwd(),
        },
      },
    });
  } catch {
    // never let telemetry break the write
  }
}
