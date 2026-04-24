import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface AcceptanceCheckInput {
  root?: string;
  issueId: string;
}

export function initializeAcceptanceCheck(input: AcceptanceCheckInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "local-verify") {
    throw new Error(
      `Acceptance check can only be initialized from local-verify phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "acceptance-check",
    payload: {
      criteria: [],
      findings: [],
      localVerifyArtifact: "local-verify",
      status: "draft",
      summary: "",
    },
  });
}
