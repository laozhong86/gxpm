import { describe, expect, test } from "bun:test";
import { ARTIFACT_TYPES } from "../core/artifacts";
import {
  GATE_ARTIFACT_TYPES,
  getGateCommand,
  getRequiredArtifactForTransition,
  isGateArtifact,
  PHASE_GATE_RULES,
} from "../core/phase-gates";
import { PHASE_ARTIFACT_COMMANDS } from "../scripts/phase-artifact-commands";

describe("phase gate registry", () => {
  test("declares every artifact-backed phase transition in order", () => {
    expect(PHASE_GATE_RULES).toEqual([
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
        nextPhase: "specify",
        requiredArtifact: "dispatch-handoff",
      },
      {
        command: "gxpm specify init <issue-id>",
        fromPhase: "specify",
        nextPhase: "implement",
        requiredArtifact: "behavior-spec",
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
        command: "gxpm self-review cleanup <issue-id>",
        fromPhase: "self-review",
        nextPhase: "cleanup",
        requiredArtifact: "cleanup-report",
      },
      {
        command: "gxpm cleanup ship <issue-id>",
        fromPhase: "cleanup",
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
    ]);
  });

  test("distinguishes gate-required artifacts from non-gate artifacts", () => {
    expect(GATE_ARTIFACT_TYPES).toEqual(PHASE_GATE_RULES.map((rule) => rule.requiredArtifact));
    expect(ARTIFACT_TYPES.filter((type) => !isGateArtifact(type))).toEqual([
      "issue-intake",
      "triage-report",
      "autopilot-grant",
      "wiki-context",
      "review-report",
      "ship-audit-report",
      "feedback-description",
    ]);
    expect(isGateArtifact("acceptance-contract")).toBe(true);
    expect(isGateArtifact("issue-intake")).toBe(false);
    expect(isGateArtifact("wiki-context")).toBe(false);
    expect(isGateArtifact("random-note")).toBe(false);
  });

  test("resolves transition artifacts and renders issue-specific gate commands", () => {
    expect(getRequiredArtifactForTransition("verify", "qa")).toBe("qa-findings");
    expect(getRequiredArtifactForTransition("land", "qa")).toBeNull();
    expect(getGateCommand("GXPM-1", "qa-findings")).toBe("gxpm verify qa GXPM-1");
  });

  test("keeps CLI artifact commands aligned with gate command hints", () => {
    expect(PHASE_ARTIFACT_COMMANDS.map((item) => item.command)).toEqual(
      PHASE_GATE_RULES.map((rule) => rule.command),
    );
    expect(
      PHASE_ARTIFACT_COMMANDS.map((item) => ({
        command: item.command,
        requiredArtifact: item.artifactType,
      })),
    ).toEqual(
      PHASE_GATE_RULES.map((rule) => ({
        command: rule.command,
        requiredArtifact: rule.requiredArtifact,
      })),
    );
  });
});
