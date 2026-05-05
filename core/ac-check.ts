import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeAcceptanceCheck = createPhaseArtifactInitializer({
  artifactType: "acceptance-check",
  label: "Acceptance check",
  payload: {
    adversarialFindings: [],
    criteria: [],
    findings: [],
    localVerifyArtifact: "local-verify",
    specCompliance: {
      missingRequirements: [],
      planCoverage: 0,
      unplannedChanges: [],
    },
    status: "draft",
    summary: "",
  },
  requiredPhase: "local-verify",
});
