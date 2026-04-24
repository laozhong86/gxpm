import { type ArtifactType, writeArtifact } from "./artifacts";
import { readIssueState, type GxpmPhase } from "./state";

export interface PhaseArtifactInput {
  root?: string;
  issueId: string;
}

interface PhaseArtifactInitializerConfig {
  artifactType: ArtifactType;
  label: string;
  payload: unknown;
  requiredPhase: GxpmPhase;
}

export function createPhaseArtifactInitializer(config: PhaseArtifactInitializerConfig) {
  return function initializePhaseArtifact(input: PhaseArtifactInput) {
    const state = readIssueState({ root: input.root, issueId: input.issueId });
    if (state.currentPhase !== config.requiredPhase) {
      throw new Error(
        `${config.label} can only be initialized from ${config.requiredPhase} phase: current phase is ${state.currentPhase}`,
      );
    }

    return writeArtifact({
      root: input.root,
      issueId: input.issueId,
      type: config.artifactType,
      payload: config.payload,
    });
  };
}
