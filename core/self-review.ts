import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeSelfReview = createPhaseArtifactInitializer({
  artifactType: "self-review",
  label: "Self review",
  payload: {
    findings: [],
    reviewedArtifacts: ["acceptance-check", "local-verify"],
    risks: [],
    status: "draft",
    summary: "",
  },
  requiredPhase: "ac-check",
});
