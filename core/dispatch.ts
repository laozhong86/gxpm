import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface DispatchInput {
  root?: string;
  issueId: string;
}

export function initializeDispatch(input: DispatchInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "dispatch") {
    throw new Error(
      `Dispatch can only be initialized from dispatch phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "dispatch-handoff",
    payload: {
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "draft",
      stopRule: "",
      targetBranch: "",
      validation: [],
      worktreePath: "",
      workerTasks: [],
    },
  });
}
