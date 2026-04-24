import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface SelfReviewInput {
  root?: string;
  issueId: string;
}

export function initializeSelfReview(input: SelfReviewInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "ac-check") {
    throw new Error(
      `Self review can only be initialized from ac-check phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "self-review",
    payload: {
      findings: [],
      reviewedArtifacts: ["acceptance-check", "local-verify"],
      risks: [],
      status: "draft",
      summary: "",
    },
  });
}
