import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializePlan = createPhaseArtifactInitializer({
  artifactType: "implementation-plan",
  label: "Plan",
  payload: {
    risks: [],
    status: "draft",
    steps: [],
    summary: "",
    validation: [],
  },
  requiredPhase: "plan",
});
