import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CODE_COMMIT_PHASES,
  PHASE_GATE_RULES,
  getRequiredArtifactForTransition,
} from "../../core/phase-gates";
import { createIssueState, transitionIssuePhase } from "../../core/state";
import { initializeShipReadiness } from "../../core/ship";

describe("Phase Gates (cleanup)", () => {
  it("includes cleanup in CODE_COMMIT_PHASES", () => {
    expect(CODE_COMMIT_PHASES.has("cleanup")).toBe(true);
  });

  it("requires cleanup-report for self-review -> cleanup", () => {
    expect(getRequiredArtifactForTransition("self-review", "cleanup")).toBe("cleanup-report");
  });

  it("requires ship-readiness for cleanup -> ship", () => {
    expect(getRequiredArtifactForTransition("cleanup", "ship")).toBe("ship-readiness");
  });

  it("places cleanup between self-review and ship in PHASE_GATE_RULES", () => {
    const selfReviewToCleanup = PHASE_GATE_RULES.find(
      (r) => r.fromPhase === "self-review" && r.nextPhase === "cleanup",
    );
    const cleanupToShip = PHASE_GATE_RULES.find(
      (r) => r.fromPhase === "cleanup" && r.nextPhase === "ship",
    );
    expect(selfReviewToCleanup).toBeDefined();
    expect(cleanupToShip).toBeDefined();
  });

  it("allows self-review -> ship with --skip-cleanup when ship-readiness exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skip-cleanup-"));
    createIssueState({ root, issueId: "G-SKIP", issueType: "feature" });

    // Advance to self-review phase
    const statePath = join(root, ".gxpm", "issues", "G-SKIP", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.currentPhase = "self-review";
    state.phaseHistory = [
      { phase: "triage", enteredAt: state.createdAt, fromPhase: null },
      { phase: "plan", enteredAt: state.createdAt, fromPhase: "triage" },
      { phase: "dispatch", enteredAt: state.createdAt, fromPhase: "plan" },
      { phase: "specify", enteredAt: state.createdAt, fromPhase: "dispatch" },
      { phase: "implement", enteredAt: state.createdAt, fromPhase: "specify" },
      { phase: "local-verify", enteredAt: state.createdAt, fromPhase: "implement" },
      { phase: "ac-check", enteredAt: state.createdAt, fromPhase: "local-verify" },
      { phase: "self-review", enteredAt: state.createdAt, fromPhase: "ac-check" },
    ];
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create ship-readiness artifact
    initializeShipReadiness({ root, issueId: "G-SKIP" });

    // Should succeed with skipCleanup
    const after = transitionIssuePhase({ root, issueId: "G-SKIP", nextPhase: "ship", skipCleanup: true });
    expect(after.currentPhase).toBe("ship");
  });

  it("blocks self-review -> ship with --skip-cleanup when ship-readiness is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skip-cleanup-block-"));
    createIssueState({ root, issueId: "G-SKIP-BLOCK", issueType: "feature" });

    const statePath = join(root, ".gxpm", "issues", "G-SKIP-BLOCK", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.currentPhase = "self-review";
    state.phaseHistory = [
      { phase: "triage", enteredAt: state.createdAt, fromPhase: null },
      { phase: "self-review", enteredAt: state.createdAt, fromPhase: "ac-check" },
    ];
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    expect(() =>
      transitionIssuePhase({ root, issueId: "G-SKIP-BLOCK", nextPhase: "ship", skipCleanup: true }),
    ).toThrow(/ship-readiness/);
  });
});

function readFileSync(path: string, encoding?: string): string {
  const { readFileSync: fsRead } = require("node:fs");
  return fsRead(path, encoding);
}
