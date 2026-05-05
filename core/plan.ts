import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializePlan = createPhaseArtifactInitializer({
  artifactType: "implementation-plan",
  label: "Plan",
  payload: {
    constitutionCheck: {
      capabilityDeclared: false,
      testStrategyDefined: false,
      simplicityJustified: false,
      integrationPathClear: false,
      status: "pending",
    },
    risks: [],
    status: "draft",
    steps: [],
    summary: "",
    validation: [],
  },
  requiredPhase: "plan",
});
