import {
  CODE_COMMIT_PHASES,
  PHASE_GATE_RULES,
  PROTECTED_PATH_PATTERNS,
} from "./phase-gates";
import type { GxpmPhase, IssueState } from "./state";

export type GateType = "pre-commit" | "commit-msg" | "pre-push" | "post-merge";

export type GateCode =
  | "no-state"
  | "no-issue-id"
  | "no-protected-paths"
  | "wrong-phase"
  | "missing-artifact"
  | "missing-issue-ref"
  | "phase-ok"
  | "land-pending"
  | "already-landed"
  | "disabled";

export interface GateVerdict {
  allowed: boolean;
  code: GateCode;
  reason: string;
  details?: Record<string, unknown>;
}

export interface PostMergeOutcome {
  transitionTo: GxpmPhase | null;
  reason: string;
}

export type Env = Record<string, string | undefined>;

export type HasArtifactFn = (issueId: string, artifactType: string) => boolean;

const ISSUE_REF_PATTERN = /\b(GXG|GXPM)-\d+\b/i;

function isDisabled(env: Env): boolean {
  return env.GXPM_GATE_DISABLE === "1";
}

function isProtected(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((re) => re.test(path));
}

export function evaluatePreCommit(
  state: IssueState,
  stagedFiles: string[],
  env: Env,
): GateVerdict {
  if (isDisabled(env)) {
    return { allowed: true, code: "disabled", reason: "GXPM_GATE_DISABLE=1" };
  }

  const protectedHits = stagedFiles.filter(isProtected);
  if (protectedHits.length === 0) {
    return {
      allowed: true,
      code: "no-protected-paths",
      reason: "no staged files in protected paths",
    };
  }

  if (CODE_COMMIT_PHASES.has(state.currentPhase)) {
    return {
      allowed: true,
      code: "phase-ok",
      reason: `currentPhase=${state.currentPhase} permits code edits`,
    };
  }

  return {
    allowed: false,
    code: "wrong-phase",
    reason: `currentPhase=${state.currentPhase} forbids commits to protected paths`,
    details: { protectedHits, currentPhase: state.currentPhase },
  };
}

export function evaluateCommitMsg(
  message: string,
  _state: IssueState,
  env: Env,
): GateVerdict {
  if (isDisabled(env)) {
    return { allowed: true, code: "disabled", reason: "GXPM_GATE_DISABLE=1" };
  }

  if (!ISSUE_REF_PATTERN.test(message)) {
    return {
      allowed: false,
      code: "missing-issue-ref",
      reason: "commit message must reference GXG-NNN or GXPM-NNN",
    };
  }

  return { allowed: true, code: "phase-ok", reason: "issue ref present" };
}

export function evaluatePrePush(
  state: IssueState,
  hasArtifactFn: HasArtifactFn,
  env: Env,
): GateVerdict {
  if (isDisabled(env)) {
    return { allowed: true, code: "disabled", reason: "GXPM_GATE_DISABLE=1" };
  }

  const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === state.currentPhase);
  if (!rule) {
    return {
      allowed: true,
      code: "phase-ok",
      reason: `phase=${state.currentPhase} has no outbound artifact gate`,
    };
  }

  if (!hasArtifactFn(state.issueId, rule.requiredArtifact)) {
    return {
      allowed: false,
      code: "missing-artifact",
      reason: `pre-push: ${rule.requiredArtifact} required for next transition`,
      details: { requiredArtifact: rule.requiredArtifact, command: rule.command },
    };
  }

  return { allowed: true, code: "phase-ok", reason: "required artifact present" };
}

export function evaluatePostMerge(state: IssueState): PostMergeOutcome {
  if (state.currentPhase === "qa") {
    return { transitionTo: "land", reason: "merged from qa → auto-transition to land" };
  }
  if (state.currentPhase === "land") {
    return { transitionTo: null, reason: "already landed" };
  }
  return {
    transitionTo: null,
    reason: `phase=${state.currentPhase} is not a merge-trigger phase`,
  };
}
