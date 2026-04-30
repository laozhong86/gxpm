import { listIssues } from "./issues";
import { classifyIssueReadiness } from "./issue-readiness";
import { type GxpmPhase, type IssueType } from "./state";

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
  const readiness = classifyIssueReadiness({ root, issueId });
  return {
    issueId: readiness.issueId,
    issueType: readiness.issueType,
    currentPhase: readiness.currentPhase,
    decision: readiness.decision === "ready" ? "dispatchable" : readiness.decision,
    reason: readiness.reason,
  };
}
