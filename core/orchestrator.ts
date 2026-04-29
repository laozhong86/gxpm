import { hasArtifact } from "./artifacts";
import { listIssues } from "./issues";
import { readIssueState, type GxpmPhase, type IssueType } from "./state";

export type DryRunDecision = "dispatchable" | "blocked" | "ignored";

export interface OrchestratorDryRunIssue {
  issueId: string;
  issueType: IssueType;
  currentPhase: GxpmPhase;
  decision: DryRunDecision;
  reason: string;
}

export interface OrchestratorDryRunReport {
  schemaVersion: 1;
  generatedAt: string;
  issues: OrchestratorDryRunIssue[];
  summary: {
    dispatchable: number;
    blocked: number;
    ignored: number;
  };
}

export function dryRunOrchestratorTick(input: { root?: string; includeAll?: boolean } = {}): OrchestratorDryRunReport {
  const root = input.root ?? process.cwd();
  const entries = listIssues({ root, includeAll: true });
  const issues = entries
    .map((entry) => classifyIssue(root, entry.issueId))
    .filter((issue) => input.includeAll || issue.decision !== "ignored");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    issues,
    summary: {
      dispatchable: issues.filter((issue) => issue.decision === "dispatchable").length,
      blocked: issues.filter((issue) => issue.decision === "blocked").length,
      ignored: issues.filter((issue) => issue.decision === "ignored").length,
    },
  };
}

function classifyIssue(root: string, issueId: string): OrchestratorDryRunIssue {
  const state = readIssueState({ root, issueId });
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

  return { ...base, decision: "dispatchable", reason: "ready_for_run" };
}
