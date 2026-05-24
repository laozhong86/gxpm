import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { hasArtifact } from "./artifacts";
import { listIssues } from "./issues";
import { assessLandCompletion } from "./land-completion";
import {
  appendIssueEvent,
  buildOwnershipChangedEvent,
  getIssuePaths,
  readIssueState,
  touchIssueOwnership,
  type GxpmPhase,
  type IssueClaim,
  type IssueType,
  type StateEvent,
} from "./state";
import { resolveAgentIdentity, resolveSessionId } from "./session";
import { isTerminalRunStatus, readRun } from "./runs";

export type IssueReadinessDecision = "ready" | "blocked" | "ignored";

export const DEFAULT_CLAIM_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface IssueReadiness {
  issueId: string;
  issueType: IssueType;
  currentPhase: GxpmPhase;
  decision: IssueReadinessDecision;
  reason: string;
  claim?: IssueClaim;
}

export interface ClaimIssueResult {
  issueId: string;
  claimed: boolean;
  claim: IssueClaim;
}

export interface ReleaseIssueClaimResult {
  issueId: string;
  released: boolean;
  claim: IssueClaim;
}

export interface ReconcileIssueClaimResult {
  issueId: string;
  reconciled: boolean;
  action: "none" | "released" | "marked_stale";
  reason: string;
  claim?: IssueClaim;
}

export function listReadyIssues(input: { root?: string } = {}): IssueReadiness[] {
  return listIssueReadiness({ root: input.root, includeAll: true }).filter((issue) => issue.decision === "ready");
}

export function listIssueReadiness(input: { root?: string; includeAll?: boolean } = {}): IssueReadiness[] {
  const root = input.root ?? process.cwd();
  const issues = listIssues({ root, includeAll: true }).map((entry) =>
    classifyIssueReadiness({ root, issueId: entry.issueId }),
  );
  return input.includeAll ? issues : issues.filter((issue) => issue.decision === "ready");
}

export function classifyIssueReadiness(input: {
  root?: string;
  issueId: string;
  now?: Date | string;
  staleAfterMs?: number;
}): IssueReadiness {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  const base = {
    issueId: state.issueId,
    issueType: state.issueType ?? "feature",
    currentPhase: state.currentPhase,
  };

  if (state.archived) {
    return { ...base, decision: "ignored", reason: "archived" };
  }
  if (state.issueType && state.issueType !== "feature") {
    return { ...base, decision: "ignored", reason: `issue_type_${state.issueType}` };
  }
  if (state.currentPhase === "land") {
    const completion = assessLandCompletion({ root, issueId: state.issueId });
    return completion.complete
      ? { ...base, decision: "ignored", reason: "landed" }
      : { ...base, decision: "blocked", reason: `land_completion_incomplete:${completion.missing.join("|")}` };
  }
  if (state.currentPhase !== "implement") {
    return { ...base, decision: "blocked", reason: `phase_${state.currentPhase}_not_implement` };
  }
  if (!hasArtifact({ root, issueId: state.issueId, type: "dispatch-handoff" })) {
    return { ...base, decision: "blocked", reason: "missing_dispatch_handoff" };
  }
  if (state.claim) {
    const claimDecision = classifyClaim({
      root,
      issueId: state.issueId,
      claim: state.claim,
      now: input.now,
      staleAfterMs: input.staleAfterMs,
    });
    return { ...base, ...claimDecision };
  }

  return { ...base, decision: "ready", reason: "ready_for_run" };
}

export function claimIssue(input: {
  root?: string;
  issueId: string;
  actor?: string;
  sessionId?: string;
  runId?: string;
}): ClaimIssueResult {
  const root = input.root ?? process.cwd();
  const sessionId = input.sessionId ?? resolveSessionId();
  const actor = input.actor ?? resolveAgentIdentity(process.env, root).actor;
  return withClaimLock(root, input.issueId, (paths) => {
    const state = readIssueState({ root, issueId: input.issueId });

    if (state.claim?.status === "claimed") {
      if (state.claim.claimedBySession === sessionId && state.claim.actor === actor) {
        return { issueId: state.issueId, claimed: false, claim: state.claim };
      }
      throw new Error(`Issue already claimed: ${state.issueId} by ${state.claim.claimedBySession}`);
    }

    const readiness = classifyIssueReadiness({ root, issueId: input.issueId });
    if (readiness.decision !== "ready") {
      throw new Error(`Issue not claimable: ${state.issueId} (${readiness.reason})`);
    }

    const now = new Date().toISOString();
    const claim: IssueClaim = {
      status: "claimed",
      actor,
      claimedBySession: sessionId,
      claimedAt: now,
      runId: input.runId,
    };
    const updated = touchIssueOwnership({
      state: { ...state, claim, updatedAt: now },
      sessionId,
    });

    writeFileSync(paths.statePath, `${JSON.stringify(updated, null, 2)}\n`);
    const ownershipEvent = buildOwnershipChangedEvent({
      issueId: state.issueId,
      timestamp: now,
      previousState: state,
      nextState: updated,
      sessionId,
    });
    if (ownershipEvent) {
      appendIssueEvent({ issueDir: paths.issueDir, event: ownershipEvent });
    }
    appendIssueEvent({
      issueDir: paths.issueDir,
      event: issueClaimedEvent(state.issueId, now, claim),
    });

    return { issueId: state.issueId, claimed: true, claim };
  });
}

export function releaseIssueClaim(input: {
  root?: string;
  issueId: string;
  reason?: string;
  sessionId?: string;
  now?: Date | string;
}): ReleaseIssueClaimResult {
  const root = input.root ?? process.cwd();
  const sessionId = input.sessionId ?? resolveSessionId();
  return withClaimLock(root, input.issueId, (paths) => {
    const state = readIssueState({ root, issueId: input.issueId });
    if (!state.claim) {
      throw new Error(`Issue has no claim to release: ${state.issueId}`);
    }
    if (state.claim.status === "released") {
      return { issueId: state.issueId, released: false, claim: state.claim };
    }

    const now = normalizeNow(input.now);
    const claim: IssueClaim = {
      status: "released",
      actor: state.claim.actor,
      claimedBySession: state.claim.claimedBySession,
      claimedAt: state.claim.claimedAt,
      runId: state.claim.runId,
      releasedAt: now,
      releasedBySession: sessionId,
      releaseReason: input.reason ?? "manual_release",
    };
    writeClaimUpdate({
      paths,
      state,
      claim,
      sessionId,
      event: issueClaimReleasedEvent(state.issueId, now, claim),
    });

    return { issueId: state.issueId, released: true, claim };
  });
}

export function reconcileIssueClaim(input: {
  root?: string;
  issueId: string;
  sessionId?: string;
  now?: Date | string;
  staleAfterMs?: number;
}): ReconcileIssueClaimResult {
  const root = input.root ?? process.cwd();
  const sessionId = input.sessionId ?? resolveSessionId();
  return withClaimLock(root, input.issueId, (paths) => {
    const state = readIssueState({ root, issueId: input.issueId });
    if (!state.claim) {
      return { issueId: state.issueId, reconciled: false, action: "none", reason: "no_claim" };
    }
    if (state.claim.status !== "claimed") {
      return {
        issueId: state.issueId,
        reconciled: false,
        action: "none",
        reason: `claim_${state.claim.status}`,
        claim: state.claim,
      };
    }

    const terminalRun = terminalRunForClaim(root, state.issueId, state.claim);
    if (terminalRun) {
      const now = normalizeNow(input.now);
      const claim: IssueClaim = {
        status: "released",
        actor: state.claim.actor,
        claimedBySession: state.claim.claimedBySession,
        claimedAt: state.claim.claimedAt,
        runId: state.claim.runId,
        releasedAt: now,
        releasedBySession: sessionId,
        releaseReason: `run_${terminalRun.status}`,
      };
      writeClaimUpdate({
        paths,
        state,
        claim,
        sessionId,
        event: issueClaimReleasedEvent(state.issueId, now, claim),
      });
      return {
        issueId: state.issueId,
        reconciled: true,
        action: "released",
        reason: `run_${terminalRun.status}`,
        claim,
      };
    }

    if (isStaleClaim(state.claim, input.now, input.staleAfterMs)) {
      const now = normalizeNow(input.now);
      const claim: IssueClaim = {
        status: "stale",
        actor: state.claim.actor,
        claimedBySession: state.claim.claimedBySession,
        claimedAt: state.claim.claimedAt,
        runId: state.claim.runId,
        staleAt: now,
        staleReason: "claim_age_exceeded",
      };
      writeClaimUpdate({
        paths,
        state,
        claim,
        sessionId,
        event: issueClaimStaleEvent(state.issueId, now, claim, sessionId),
      });
      return {
        issueId: state.issueId,
        reconciled: true,
        action: "marked_stale",
        reason: "claim_age_exceeded",
        claim,
      };
    }

    return { issueId: state.issueId, reconciled: false, action: "none", reason: "claim_active", claim: state.claim };
  });
}

function withClaimLock<T>(root: string, issueId: string, action: (paths: ReturnType<typeof getIssuePaths>) => T): T {
  const paths = getIssuePaths(root, issueId);
  const lockPath = `${paths.issueDir}/.claim.lock`;
  let lockFd: number | null = null;
  try {
    lockFd = openSync(lockPath, "wx");
    return action(paths);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`Issue claim locked: ${issueId}`);
    }
    throw error;
  } finally {
    if (lockFd !== null) {
      closeSync(lockFd);
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }
}

function classifyClaim(input: {
  root: string;
  issueId: string;
  claim: IssueClaim;
  now?: Date | string;
  staleAfterMs?: number;
}): Pick<IssueReadiness, "decision" | "reason" | "claim"> {
  if (input.claim.status === "released") {
    return { decision: "ready", reason: "claim_released", claim: input.claim };
  }
  if (input.claim.status === "stale") {
    return { decision: "blocked", reason: "stale_claim", claim: input.claim };
  }

  const terminalRun = terminalRunForClaim(input.root, input.issueId, input.claim);
  if (terminalRun) {
    return {
      decision: "blocked",
      reason: `claim_run_${terminalRun.status}_needs_reconcile`,
      claim: input.claim,
    };
  }
  if (isStaleClaim(input.claim, input.now, input.staleAfterMs)) {
    return { decision: "blocked", reason: "stale_claim", claim: input.claim };
  }
  return { decision: "blocked", reason: "claimed_by_session", claim: input.claim };
}

function writeClaimUpdate(input: {
  paths: ReturnType<typeof getIssuePaths>;
  state: ReturnType<typeof readIssueState>;
  claim: IssueClaim;
  sessionId: string;
  event: StateEvent;
}) {
  const now = input.event.timestamp;
  const updated = touchIssueOwnership({
    state: { ...input.state, claim: input.claim, updatedAt: now },
    sessionId: input.sessionId,
  });

  writeFileSync(input.paths.statePath, `${JSON.stringify(updated, null, 2)}\n`);
  const ownershipEvent = buildOwnershipChangedEvent({
    issueId: input.state.issueId,
    timestamp: now,
    previousState: input.state,
    nextState: updated,
    sessionId: input.sessionId,
  });
  if (ownershipEvent) {
    appendIssueEvent({ issueDir: input.paths.issueDir, event: ownershipEvent });
  }
  appendIssueEvent({ issueDir: input.paths.issueDir, event: input.event });
}

function terminalRunForClaim(root: string, issueId: string, claim: IssueClaim) {
  if (claim.status !== "claimed" || !claim.runId) {
    return null;
  }
  try {
    const run = readRun({ root, issueId, runId: claim.runId });
    return isTerminalRunStatus(run.status) ? run : null;
  } catch {
    return null;
  }
}

function isStaleClaim(claim: IssueClaim, now: Date | string | undefined, staleAfterMs: number | undefined) {
  if (claim.status !== "claimed") {
    return false;
  }
  const claimedAtMs = Date.parse(claim.claimedAt);
  if (!Number.isFinite(claimedAtMs)) {
    return false;
  }
  const threshold = staleAfterMs ?? DEFAULT_CLAIM_STALE_AFTER_MS;
  if (!Number.isFinite(threshold) || threshold < 0) {
    return false;
  }
  return Date.parse(normalizeNow(now)) - claimedAtMs >= threshold;
}

function normalizeNow(value: Date | string | undefined) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}

function issueClaimedEvent(issueId: string, timestamp: string, claim: IssueClaim): StateEvent {
  return {
    schemaVersion: 1,
    type: "issue.claimed",
    issueId,
    timestamp,
    sessionId: claim.claimedBySession,
    payload: {
      actor: claim.actor,
      claimedBySession: claim.claimedBySession,
      claimedAt: claim.claimedAt,
      runId: claim.runId,
    },
  };
}

function issueClaimReleasedEvent(issueId: string, timestamp: string, claim: IssueClaim): StateEvent {
  return {
    schemaVersion: 1,
    type: "issue.claim.released",
    issueId,
    timestamp,
    sessionId: claim.status === "released" ? claim.releasedBySession : undefined,
    payload: {
      actor: claim.actor,
      claimedBySession: claim.claimedBySession,
      claimedAt: claim.claimedAt,
      runId: claim.runId,
      releasedAt: claim.status === "released" ? claim.releasedAt : undefined,
      releasedBySession: claim.status === "released" ? claim.releasedBySession : undefined,
      releaseReason: claim.status === "released" ? claim.releaseReason : undefined,
    },
  };
}

function issueClaimStaleEvent(
  issueId: string,
  timestamp: string,
  claim: IssueClaim,
  reconciledBySession: string,
): StateEvent {
  return {
    schemaVersion: 1,
    type: "issue.claim.stale",
    issueId,
    timestamp,
    sessionId: reconciledBySession,
    payload: {
      actor: claim.actor,
      claimedBySession: claim.claimedBySession,
      claimedAt: claim.claimedAt,
      runId: claim.runId,
      reconciledBySession,
      staleAt: claim.status === "stale" ? claim.staleAt : undefined,
      staleReason: claim.status === "stale" ? claim.staleReason : undefined,
    },
  };
}
