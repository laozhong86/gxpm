import { initializeAcceptanceCheck } from "../core/ac-check";
import { type ArtifactType } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializeLandFindings } from "../core/land";
import { initializePlan } from "../core/plan";
import { initializePrCheck } from "../core/pr-check";
import { initializeQaFindings } from "../core/qa";
import { initializeSelfReview } from "../core/self-review";
import { initializeShipReadiness } from "../core/ship";
import { initializeTriage } from "../core/triage";
import { initializeVerifyFindings } from "../core/verify";

interface PhaseArtifactCommand {
  artifactType: ArtifactType;
  command: string;
  initialize: (input: { issueId: string }) => unknown;
  successMessage: (issueId: string) => string;
}

export const PHASE_ARTIFACT_COMMANDS: PhaseArtifactCommand[] = [
  {
    artifactType: "acceptance-contract",
    command: "gxpm triage init <issue-id>",
    initialize: initializeTriage,
    successMessage: (issueId) => `initialized triage artifacts for ${issueId}`,
  },
  {
    artifactType: "implementation-plan",
    command: "gxpm plan init <issue-id>",
    initialize: initializePlan,
    successMessage: (issueId) => `initialized plan artifact for ${issueId}`,
  },
  {
    artifactType: "dispatch-handoff",
    command: "gxpm dispatch init <issue-id>",
    initialize: initializeDispatch,
    successMessage: (issueId) => `initialized dispatch handoff for ${issueId}`,
  },
  {
    artifactType: "local-verify",
    command: "gxpm implement verify <issue-id>",
    initialize: initializeLocalVerify,
    successMessage: (issueId) => `initialized local verify artifact for ${issueId}`,
  },
  {
    artifactType: "acceptance-check",
    command: "gxpm local-verify ac-check <issue-id>",
    initialize: initializeAcceptanceCheck,
    successMessage: (issueId) => `initialized acceptance check artifact for ${issueId}`,
  },
  {
    artifactType: "self-review",
    command: "gxpm ac-check self-review <issue-id>",
    initialize: initializeSelfReview,
    successMessage: (issueId) => `initialized self review artifact for ${issueId}`,
  },
  {
    artifactType: "ship-readiness",
    command: "gxpm self-review ship <issue-id>",
    initialize: initializeShipReadiness,
    successMessage: (issueId) => `initialized ship readiness artifact for ${issueId}`,
  },
  {
    artifactType: "pr-check",
    command: "gxpm ship pr-check <issue-id>",
    initialize: initializePrCheck,
    successMessage: (issueId) => `initialized pr check artifact for ${issueId}`,
  },
  {
    artifactType: "verify-findings",
    command: "gxpm pr-check verify <issue-id>",
    initialize: initializeVerifyFindings,
    successMessage: (issueId) => `initialized verify findings artifact for ${issueId}`,
  },
  {
    artifactType: "qa-findings",
    command: "gxpm verify qa <issue-id>",
    initialize: initializeQaFindings,
    successMessage: (issueId) => `initialized QA findings artifact for ${issueId}`,
  },
  {
    artifactType: "land-findings",
    command: "gxpm qa land <issue-id>",
    initialize: initializeLandFindings,
    successMessage: (issueId) => `initialized land findings artifact for ${issueId}`,
  },
];

export function findPhaseArtifactCommand(command: string, subcommand: string | undefined) {
  return PHASE_ARTIFACT_COMMANDS.find((item) => {
    const [, registeredCommand, registeredSubcommand] = item.command.split(" ");
    return registeredCommand === command && registeredSubcommand === subcommand;
  });
}
