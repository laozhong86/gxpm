import { writeArtifact } from "./artifacts";

interface TriageInput {
  root?: string;
  issueId: string;
}

export function initializeTriage(input: TriageInput) {
  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "acceptance-contract",
    payload: {
      criteria: [],
      notes: "Fill criteria during triage before planning work.",
      status: "draft",
    },
  });
}
