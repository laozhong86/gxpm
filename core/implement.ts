import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeLocalVerify = createPhaseArtifactInitializer({
  artifactType: "local-verify",
  label: "Local verify",
  payload: {
    changedFiles: [],
    commands: [],
    evidence: [],
    results: [],
    risks: [],
    status: "draft",
  },
  requiredPhase: "implement",
});
