import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeDispatch = createPhaseArtifactInitializer({
  artifactType: "dispatch-handoff",
  label: "Dispatch",
  payload: {
    inputArtifacts: ["acceptance-contract", "implementation-plan"],
    status: "draft",
    stopRule: "",
    targetBranch: "",
    validation: [],
    worktreePath: "",
    workerTasks: [],
  },
  requiredPhase: "dispatch",
});
