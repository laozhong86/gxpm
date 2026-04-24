import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeAcceptanceCheck = createPhaseArtifactInitializer({
  artifactType: "acceptance-check",
  label: "Acceptance check",
  payload: {
    criteria: [],
    findings: [],
    localVerifyArtifact: "local-verify",
    status: "draft",
    summary: "",
  },
  requiredPhase: "local-verify",
});
