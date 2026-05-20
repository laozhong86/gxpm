import { type ArtifactType } from "./artifacts";
import { type GxpmPhase } from "./state";

export const CODE_COMMIT_PHASES: ReadonlySet<GxpmPhase> = new Set([
  "dispatch",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "cleanup",
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
  // Which gxpm-* skill the agent MUST invoke when entering fromPhase, before
  // doing any work. null = mechanical CLI step with no skill required.
  // Surfaced by `gxpm issue next` (text + --json) and the main SKILL.md
  // Phase → Required Skill contract table.
  requiredSkill: string | null;
}

export const PHASE_GATE_RULES: PhaseGateRule[] = [
  {
    command: "gxpm triage init <issue-id>",
    fromPhase: "triage",
    nextPhase: "plan",
    requiredArtifact: "acceptance-contract",
    requiredSkill: "gxpm-triage",
  },
  {
    command: "gxpm plan init <issue-id>",
    fromPhase: "plan",
    nextPhase: "dispatch",
    requiredArtifact: "implementation-plan",
    requiredSkill: "gxpm-planning",
  },
  {
    command: "gxpm dispatch init <issue-id>",
    fromPhase: "dispatch",
    nextPhase: "specify",
    requiredArtifact: "dispatch-handoff",
    requiredSkill: null,
  },
  {
    command: "gxpm specify init <issue-id>",
    fromPhase: "specify",
    nextPhase: "implement",
    requiredArtifact: "behavior-spec",
    requiredSkill: "gxpm-specifier",
  },
  {
    command: "gxpm implement verify <issue-id>",
    fromPhase: "implement",
    nextPhase: "local-verify",
    requiredArtifact: "local-verify",
    requiredSkill: "gxpm-tdd",
  },
  {
    command: "gxpm local-verify ac-check <issue-id>",
    fromPhase: "local-verify",
    nextPhase: "ac-check",
    requiredArtifact: "acceptance-check",
    requiredSkill: "gxpm-verify",
  },
  {
    command: "gxpm ac-check self-review <issue-id>",
    fromPhase: "ac-check",
    nextPhase: "self-review",
    requiredArtifact: "self-review",
    requiredSkill: "gxpm-verify",
  },
  {
    command: "gxpm self-review cleanup <issue-id>",
    fromPhase: "self-review",
    nextPhase: "cleanup",
    requiredArtifact: "cleanup-report",
    requiredSkill: "gxpm-review-changes",
  },
  {
    command: "gxpm cleanup ship <issue-id>",
    fromPhase: "cleanup",
    nextPhase: "ship",
    requiredArtifact: "ship-readiness",
    requiredSkill: "gxpm-cleanup",
  },
  {
    command: "gxpm ship pr-check <issue-id>",
    fromPhase: "ship",
    nextPhase: "pr-check",
    requiredArtifact: "pr-check",
    requiredSkill: null,
  },
  {
    command: "gxpm pr-check verify <issue-id>",
    fromPhase: "pr-check",
    nextPhase: "verify",
    requiredArtifact: "verify-findings",
    requiredSkill: "gxpm-review-changes",
  },
  {
    command: "gxpm verify qa <issue-id>",
    fromPhase: "verify",
    nextPhase: "qa",
    requiredArtifact: "qa-findings",
    requiredSkill: "gxpm-verify",
  },
  {
    command: "gxpm qa land <issue-id>",
    fromPhase: "qa",
    nextPhase: "land",
    requiredArtifact: "land-findings",
    requiredSkill: "gxpm-browser",
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
