import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface VerifyInput {
  root?: string;
  issueId: string;
}

export function initializeVerifyFindings(input: VerifyInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "pr-check") {
    throw new Error(
      `Verify findings can only be initialized from pr-check phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "verify-findings",
    payload: {
      acceptanceContractArtifact: "acceptance-contract",
      findings: [],
      prCheckArtifact: "pr-check",
      risks: [],
      status: "draft",
      summary: "",
    },
  });
}
