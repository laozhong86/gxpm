import { initializeAcceptanceCheck } from "../core/ac-check";
import { type ArtifactType } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializeLandFindings } from "../core/land";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { initializePlan } from "../core/plan";
import { initializePrCheck } from "../core/pr-check";
import { initializeQaFindings } from "../core/qa";
import { initializeSelfReview } from "../core/self-review";
import { initializeShipReadiness } from "../core/ship";
import { initializeCleanup } from "../core/cleanup";
import { initializeSpecify } from "../core/specify";
import { initializeTriage } from "../core/triage";
import { initializeVerifyFindings } from "../core/verify";

interface PhaseArtifactCommand {
  artifactType: ArtifactType;
  command: string;
  initialize: (input: { issueId: string }) => unknown;
  successMessage: (issueId: string) => string;
}

const PHASE_ARTIFACT_HANDLERS: Partial<Record<
  ArtifactType,
  Pick<PhaseArtifactCommand, "initialize" | "successMessage">
>> = {
  "acceptance-contract": {
    initialize: initializeTriage,
    successMessage: (issueId) => `initialized triage artifacts for ${issueId}`,
  },
  "implementation-plan": {
    initialize: initializePlan,
    successMessage: (issueId) => `initialized plan artifact for ${issueId}`,
  },
  "dispatch-handoff": {
    initialize: initializeDispatch,
    successMessage: (issueId) => `initialized dispatch handoff for ${issueId}`,
  },
  "behavior-spec": {
    initialize: initializeSpecify,
    successMessage: (issueId) => `initialized behavior-spec artifact for ${issueId}`,
  },
  "local-verify": {
    initialize: initializeLocalVerify,
    successMessage: (issueId) => `initialized local verify artifact for ${issueId}`,
  },
  "acceptance-check": {
    initialize: initializeAcceptanceCheck,
    successMessage: (issueId) => `initialized acceptance check artifact for ${issueId}`,
  },
  "self-review": {
    initialize: (input) => initializeSelfReview({ ...input, army: process.argv.includes("--army") }),
    successMessage: (issueId) => `initialized self review artifact for ${issueId}`,
  },
  "cleanup-report": {
    initialize: initializeCleanup,
    successMessage: (issueId) => `initialized cleanup report for ${issueId}`,
  },
  "ship-readiness": {
    initialize: (input) => initializeShipReadiness({ ...input, army: process.argv.includes("--army") }),
    successMessage: (issueId) => `initialized ship readiness artifact for ${issueId}`,
  },
  "pr-check": {
    initialize: initializePrCheck,
    successMessage: (issueId) => `initialized pr check artifact for ${issueId}`,
  },
  "verify-findings": {
    initialize: initializeVerifyFindings,
    successMessage: (issueId) => `initialized verify findings artifact for ${issueId}`,
  },
  "qa-findings": {
    initialize: initializeQaFindings,
    successMessage: (issueId) => `initialized QA findings artifact for ${issueId}`,
  },
  "land-findings": {
    initialize: initializeLandFindings,
    successMessage: (issueId) => `initialized land findings artifact for ${issueId}`,
  },
};

export const PHASE_ARTIFACT_COMMANDS: PhaseArtifactCommand[] = PHASE_GATE_RULES.map((rule) => {
  const handler = PHASE_ARTIFACT_HANDLERS[rule.requiredArtifact];
  if (!handler) {
    throw new Error(`Missing phase artifact handler for ${rule.requiredArtifact}`);
  }

  return {
    artifactType: rule.requiredArtifact,
    command: rule.command,
    ...handler,
  };
});

export function findPhaseArtifactCommand(command: string, subcommand: string | undefined) {
  return PHASE_ARTIFACT_COMMANDS.find((item) => {
    const [, registeredCommand, registeredSubcommand] = item.command.split(" ");
    return registeredCommand === command && registeredSubcommand === subcommand;
  });
}
