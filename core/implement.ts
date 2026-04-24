import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface ImplementInput {
  root?: string;
  issueId: string;
}

export function initializeLocalVerify(input: ImplementInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "implement") {
    throw new Error(
      `Local verify can only be initialized from implement phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "local-verify",
    payload: {
      changedFiles: [],
      commands: [],
      evidence: [],
      results: [],
      risks: [],
      status: "draft",
    },
  });
}
