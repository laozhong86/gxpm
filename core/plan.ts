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

  // GXPM-149: include approach + validation even in lite payload so the draft
  // passes the validator schema (implementation-plan requires
  // [objective, approach, validation]). Lite issues can leave them empty;
  // schema satisfaction matters more than minimalism.
  const litePayload = {
    objective: "",
    approach: "",
    validation: [],
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
