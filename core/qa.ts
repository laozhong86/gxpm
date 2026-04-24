import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeQaFindings = createPhaseArtifactInitializer({
  artifactType: "qa-findings",
  label: "QA findings",
  payload: {
    browserEvidence: [],
    findings: [],
    risks: [],
    status: "draft",
    summary: "",
    verifyFindingsArtifact: "verify-findings",
  },
  requiredPhase: "verify",
});
