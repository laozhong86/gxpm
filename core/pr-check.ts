import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface PrCheckInput {
  root?: string;
  issueId: string;
}

export function initializePrCheck(input: PrCheckInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "ship") {
    throw new Error(
      `PR check can only be initialized from ship phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "pr-check",
    payload: {
      pullRequest: "",
      reviewFindings: [],
      risks: [],
      shipReadinessArtifact: "ship-readiness",
      status: "draft",
      summary: "",
    },
  });
}
