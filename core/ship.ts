import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeShipReadiness = createPhaseArtifactInitializer({
  artifactType: "ship-readiness",
  label: "Ship readiness",
  payload: {
    checklist: [],
    releaseNotes: "",
    reviewedArtifacts: ["self-review", "acceptance-check"],
    risks: [],
    status: "draft",
    summary: "",
    targetBranch: "",
  },
  requiredPhase: "self-review",
});
