import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeVerifyFindings = createPhaseArtifactInitializer({
  artifactType: "verify-findings",
  label: "Verify findings",
  payload: {
    acceptanceContractArtifact: "acceptance-contract",
    findings: [],
    prCheckArtifact: "pr-check",
    risks: [],
    status: "draft",
    summary: "",
  },
  requiredPhase: "pr-check",
});
