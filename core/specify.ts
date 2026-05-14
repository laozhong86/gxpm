import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";
import { resolveAgentIdentity } from "./session";

interface SpecifyInput {
  root?: string;
  issueId: string;
}

export function initializeSpecify(input: SpecifyInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "specify") {
    throw new Error(
      `Specify can only be initialized from specify phase: current phase is ${state.currentPhase}`,
    );
  }

  const now = new Date().toISOString();
  const identity = resolveAgentIdentity();

  const payload = {
    $schema: "behavior-spec.v1",
    issueId: input.issueId,
    createdAt: now,
    createdBy: identity.actor,
    confirmedAt: null,
    confirmedBy: null,
    feature: {
      title: "",
      asA: "",
      iWant: "",
      soThat: "",
    },
    scenarios: [
      {
        id: "scn-01",
        name: "",
        given: [""],
        when: "",
        then: [""],
        examples: [],
        stubPath: "",
      },
    ],
    guidelinesRef: "docs/governance/gherkin-style.md@v1",
  };

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "behavior-spec",
    payload,
  });
}
