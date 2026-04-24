import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface LandInput {
  root?: string;
  issueId: string;
}

export function initializeLandFindings(input: LandInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "qa") {
    throw new Error(
      `Land findings can only be initialized from qa phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "land-findings",
    payload: {
      landReady: false,
      mergePlan: "",
      qaFindingsArtifact: "qa-findings",
      releaseRisks: [],
      status: "draft",
      summary: "",
    },
  });
}
