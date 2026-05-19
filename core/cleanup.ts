import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface CleanupInput {
  root?: string;
  issueId: string;
}

export function initializeCleanup(input: CleanupInput) {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  if (state.currentPhase !== "self-review") {
    throw new Error(
      `Cleanup can only be initialized from self-review phase: current phase is ${state.currentPhase}`,
    );
  }

  return writeArtifact({
    root,
    issueId: input.issueId,
    type: "cleanup-report",
    payload: {
      duplicatesExtracted: [],
      renamesUnified: [],
      interfacesAligned: [],
      deadCodeRemoved: [],
      testsDeduplicated: [],
      notes: "",
      status: "draft",
    },
  });
}
