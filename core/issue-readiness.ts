import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { hasArtifact } from "./artifacts";
import { listIssues } from "./issues";
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
import { resolveSessionId } from "./session";

export type IssueReadinessDecision = "ready" | "blocked" | "ignored";

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

export function classifyIssueReadiness(input: { root?: string; issueId: string }): IssueReadiness {
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
    return { ...base, decision: "ignored", reason: "landed" };
  }
  if (state.currentPhase !== "implement") {
    return { ...base, decision: "blocked", reason: `phase_${state.currentPhase}_not_implement` };
  }
  if (!hasArtifact({ root, issueId: state.issueId, type: "dispatch-handoff" })) {
    return { ...base, decision: "blocked", reason: "missing_dispatch_handoff" };
  }
  if (state.claim?.status === "claimed") {
    return { ...base, decision: "blocked", reason: "claimed_by_session", claim: state.claim };
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
  const actor = input.actor ?? sessionId;
  const paths = getIssuePaths(root, input.issueId);
  const lockPath = `${paths.issueDir}/.claim.lock`;
  let lockFd: number | null = null;

  try {
    lockFd = openSync(lockPath, "wx");
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
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`Issue claim locked: ${input.issueId}`);
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
