import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface ShipInput {
  root?: string;
  issueId: string;
}

export function initializeShipReadiness(input: ShipInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "self-review") {
    throw new Error(
      `Ship readiness can only be initialized from self-review phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "ship-readiness",
    payload: {
      checklist: [],
      releaseNotes: "",
      reviewedArtifacts: ["self-review", "acceptance-check"],
      risks: [],
      status: "draft",
      summary: "",
      targetBranch: "",
    },
  });
}
