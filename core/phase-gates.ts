import { type ArtifactType } from "./artifacts";
import { type GxpmPhase } from "./state";

export const CODE_COMMIT_PHASES: ReadonlySet<GxpmPhase> = new Set([
  "dispatch",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "verify",
]);

export const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /^apps\//,
  /^server\//,
  /^packages\//,
  /^scripts\//,
  /^tests\//,
  /^supabase\//,
  /^e2e\//,
];

export interface PhaseGateRule {
  command: string;
  fromPhase: GxpmPhase;
  nextPhase: GxpmPhase;
  requiredArtifact: ArtifactType;
}

export const PHASE_GATE_RULES: PhaseGateRule[] = [
  {
    command: "gxpm triage init <issue-id>",
    fromPhase: "triage",
    nextPhase: "plan",
    requiredArtifact: "acceptance-contract",
  },
  {
    command: "gxpm plan init <issue-id>",
    fromPhase: "plan",
    nextPhase: "dispatch",
    requiredArtifact: "implementation-plan",
  },
  {
    command: "gxpm dispatch init <issue-id>",
    fromPhase: "dispatch",
    nextPhase: "implement",
    requiredArtifact: "dispatch-handoff",
  },
  {
    command: "gxpm implement verify <issue-id>",
    fromPhase: "implement",
    nextPhase: "local-verify",
    requiredArtifact: "local-verify",
  },
  {
    command: "gxpm local-verify ac-check <issue-id>",
    fromPhase: "local-verify",
    nextPhase: "ac-check",
    requiredArtifact: "acceptance-check",
  },
  {
    command: "gxpm ac-check self-review <issue-id>",
    fromPhase: "ac-check",
    nextPhase: "self-review",
    requiredArtifact: "self-review",
  },
  {
    command: "gxpm self-review ship <issue-id>",
    fromPhase: "self-review",
    nextPhase: "ship",
    requiredArtifact: "ship-readiness",
  },
  {
    command: "gxpm ship pr-check <issue-id>",
    fromPhase: "ship",
    nextPhase: "pr-check",
    requiredArtifact: "pr-check",
  },
  {
    command: "gxpm pr-check verify <issue-id>",
    fromPhase: "pr-check",
    nextPhase: "verify",
    requiredArtifact: "verify-findings",
  },
  {
    command: "gxpm verify qa <issue-id>",
    fromPhase: "verify",
    nextPhase: "qa",
    requiredArtifact: "qa-findings",
  },
  {
    command: "gxpm qa land <issue-id>",
    fromPhase: "qa",
    nextPhase: "land",
    requiredArtifact: "land-findings",
  },
];

export const GATE_ARTIFACT_TYPES = PHASE_GATE_RULES.map((rule) => rule.requiredArtifact);

export function isGateArtifact(artifactType: string): artifactType is ArtifactType {
  return GATE_ARTIFACT_TYPES.includes(artifactType as ArtifactType);
}

export function getRequiredArtifactForTransition(fromPhase: GxpmPhase, nextPhase: GxpmPhase) {
  return (
    PHASE_GATE_RULES.find((rule) => rule.fromPhase === fromPhase && rule.nextPhase === nextPhase)
      ?.requiredArtifact ?? null
  );
}

export function getGateCommand(issueId: string, artifactType: string) {
  const rule = PHASE_GATE_RULES.find((item) => item.requiredArtifact === artifactType);
  return (rule?.command ?? "gxpm triage init <issue-id>").replace("<issue-id>", issueId);
}
