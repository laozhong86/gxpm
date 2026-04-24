import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeLandFindings = createPhaseArtifactInitializer({
  artifactType: "land-findings",
  label: "Land findings",
  payload: {
    landReady: false,
    mergePlan: "",
    qaFindingsArtifact: "qa-findings",
    releaseRisks: [],
    status: "draft",
    summary: "",
  },
  requiredPhase: "qa",
});
