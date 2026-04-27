import { writeArtifact } from "./artifacts";
import { lintCodexPlans } from "./plan-lint";
import { readIssueState } from "./state";

export function initializeSelfReview(input: { root?: string; issueId: string }) {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  if (state.currentPhase !== "ac-check") {
    throw new Error(`Self review can only be initialized from ac-check phase: current phase is ${state.currentPhase}`);
  }

  return writeArtifact({
    root,
    issueId: input.issueId,
    type: "self-review",
    payload: {
      findings: [],
      reviewedArtifacts: ["acceptance-check", "local-verify"],
      risks: [],
      status: "draft",
      summary: "",
      plan_lint_findings: lintCodexPlans(root, input.issueId),
    },
  });
}
