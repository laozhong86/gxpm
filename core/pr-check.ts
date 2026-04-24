import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializePrCheck = createPhaseArtifactInitializer({
  artifactType: "pr-check",
  label: "PR check",
  payload: {
    pullRequest: "",
    reviewFindings: [],
    risks: [],
    shipReadinessArtifact: "ship-readiness",
    status: "draft",
    summary: "",
  },
  requiredPhase: "ship",
});
