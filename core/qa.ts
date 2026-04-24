import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface QaInput {
  root?: string;
  issueId: string;
}

export function initializeQaFindings(input: QaInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "verify") {
    throw new Error(
      `QA findings can only be initialized from verify phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "qa-findings",
    payload: {
      browserEvidence: [],
      findings: [],
      risks: [],
      status: "draft",
      summary: "",
      verifyFindingsArtifact: "verify-findings",
    },
  });
}
