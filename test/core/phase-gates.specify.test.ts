import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PHASE_GATE_RULES, getRequiredArtifactForTransition } from "../../core/phase-gates";
import { createIssueState, SPECIFY_PHASE_CUTOFF, transitionIssuePhase } from "../../core/state";

describe("phase-gates with specify", () => {
  it("requires dispatch-handoff for dispatch->specify", () => {
    expect(getRequiredArtifactForTransition("dispatch", "specify")).toBe("dispatch-handoff");
  });

  it("requires behavior-spec for specify->implement", () => {
    expect(getRequiredArtifactForTransition("specify", "implement")).toBe("behavior-spec");
  });

  it("removes original dispatch->implement direct rule", () => {
    const direct = PHASE_GATE_RULES.find(
      (r) => r.fromPhase === "dispatch" && r.nextPhase === "implement",
    );
    expect(direct).toBeUndefined();
  });

  it("registers a handler for behavior-spec so PHASE_ARTIFACT_COMMANDS imports cleanly", async () => {
    // Importing this module triggers the .map() over PHASE_GATE_RULES which throws
    // if any rule's requiredArtifact has no handler. Successful import = handler exists.
    await import("../../scripts/phase-artifact-commands");
  });
});

function setupIssueInSpecify(root: string, issueId: string) {
  createIssueState({ root, issueId, issueType: "feature" });
  const stateFile = join(root, ".gxpm", "issues", issueId, "state.json");
  const raw = JSON.parse(readFileSync(stateFile, "utf8"));
  raw.currentPhase = "specify";
  raw.phaseHistory.push({ phase: "specify", enteredAt: "2026-05-14T00:00:00Z", fromPhase: "dispatch" });
  writeFileSync(stateFile, JSON.stringify(raw, null, 2));
  return stateFile;
}

function writeBehaviorSpec(root: string, issueId: string, confirmedAt: string | null) {
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "behavior-spec.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "behavior-spec",
      writtenAt: "2026-05-14T00:00:00Z",
      payload: {
        $schema: "behavior-spec.v1",
        confirmedAt,
        confirmedBy: confirmedAt ? "alice" : null,
        scenarios: [],
      },
    }, null, 2),
  );
}

describe("specify->implement gate confirmedAt check", () => {
  it("blocks transition when behavior-spec.confirmedAt is null", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirmed-null-"));
    setupIssueInSpecify(root, "G-A");
    writeBehaviorSpec(root, "G-A", null);
    expect(() =>
      transitionIssuePhase({ root, issueId: "G-A", nextPhase: "implement" }),
    ).toThrow(/confirmedAt is null/);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows transition when behavior-spec.confirmedAt is set", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirmed-set-"));
    setupIssueInSpecify(root, "G-B");
    writeBehaviorSpec(root, "G-B", "2026-05-14T01:00:00.000Z");
    expect(() =>
      transitionIssuePhase({ root, issueId: "G-B", nextPhase: "implement" }),
    ).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("specify-gate backward compatibility", () => {
  it("exports SPECIFY_PHASE_CUTOFF as a stable ISO-8601 string", () => {
    expect(SPECIFY_PHASE_CUTOFF).toBe("2026-05-14T00:00:00Z");
  });

  it("bypasses specify gate when implement was entered before cutoff", () => {
    // Setup: an issue that historically transitioned dispatch->implement directly
    // (before specify phase existed). Now we artificially force its current phase
    // back to "specify" and attempt to re-enter implement WITHOUT a behavior-spec.
    // The legacy bypass should let it through because the legacy phaseHistory
    // entry exists.
    const root = mkdtempSync(join(tmpdir(), "gxpm-legacy-"));
    createIssueState({ root, issueId: "G-LEG", issueType: "feature" });
    const stateFile = join(root, ".gxpm", "issues", "G-LEG", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    raw.phaseHistory = [
      { phase: "triage", enteredAt: "2025-12-01T00:00:00Z", fromPhase: null },
      { phase: "plan", enteredAt: "2025-12-02T00:00:00Z", fromPhase: "triage" },
      { phase: "dispatch", enteredAt: "2025-12-03T00:00:00Z", fromPhase: "plan" },
      { phase: "implement", enteredAt: "2025-12-04T00:00:00Z", fromPhase: "dispatch" },
      { phase: "specify", enteredAt: "2026-05-14T00:00:00Z", fromPhase: "dispatch" },
    ];
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));
    // No behavior-spec.json on disk — legacy bypass must let it through.
    expect(() =>
      transitionIssuePhase({ root, issueId: "G-LEG", nextPhase: "implement" }),
    ).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});
