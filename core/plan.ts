import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";

interface PlanInput {
  root?: string;
  issueId: string;
}

export function initializePlan(input: PlanInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "plan") {
    throw new Error(
      `Plan can only be initialized from plan phase: current phase is ${state.currentPhase}`,
    );
  }

  const rigor = state.rigorLevel ?? "standard";

  const constitutionCheck = {
    capabilityDeclared: false,
    testStrategyDefined: false,
    simplicityJustified: false,
    integrationPathClear: false,
    status: "pending",
  };

  const litePayload = {
    objective: "",
    scope: "",
    nonGoals: "",
    constitutionCheck,
    steps: [],
    status: "draft",
  };

  const standardPayload = {
    objective: "",
    scope: "",
    nonGoals: "",
    approach: "",
    constitutionCheck,
    steps: [],
    risks: [],
    validation: [],
    rollback: "",
    status: "draft",
  };

  const fullPayload = {
    objective: "",
    scope: "",
    nonGoals: "",
    approach: "",
    chosenApproach: "",
    whyThisApproach: "",
    implementationSlices: [],
    dataModel: "",
    alternativesConsidered: [],
    alternativesRejected: [],
    constitutionCheck,
    steps: [],
    risks: [],
    validation: [],
    rollback: "",
    migrationPlan: "",
    status: "draft",
  };

  const payload = rigor === "lite" ? litePayload : rigor === "full" ? fullPayload : standardPayload;

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "implementation-plan",
    payload,
  });
}
