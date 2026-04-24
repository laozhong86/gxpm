import { readIssueState } from "./state";
import { writeArtifact } from "./artifacts";

interface PlanInput {
  root?: string;
  issueId: string;
}

export function initializePlan(input: PlanInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "plan") {
    throw new Error(`Plan can only be initialized from plan phase: current phase is ${state.currentPhase}`);
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "implementation-plan",
    payload: {
      risks: [],
      status: "draft",
      steps: [],
      summary: "",
      validation: [],
    },
  });
}
