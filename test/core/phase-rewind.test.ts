import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewindPhase } from "../../core/phase-rewind";
import { createIssueState } from "../../core/state";

function setupIssueWithHistory(root: string, issueId: string, phases: string[]) {
  createIssueState({ root, issueId, issueType: "feature" });
  const stateFile = join(root, ".gxpm", "issues", issueId, "state.json");
  const raw = JSON.parse(readFileSync(stateFile, "utf8"));
  raw.phaseHistory = phases.map((phase, idx) => ({
    phase,
    enteredAt: `2026-05-14T0${idx}:00:00Z`,
    fromPhase: idx === 0 ? null : phases[idx - 1],
  }));
  raw.currentPhase = phases[phases.length - 1];
  writeFileSync(stateFile, JSON.stringify(raw, null, 2));
}

describe("rewindPhase", () => {
  it("moves currentPhase back to a phase present in history", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-rewind-ok-"));
    setupIssueWithHistory(root, "G-RW1", ["triage", "plan", "dispatch", "specify", "implement"]);

    const result = rewindPhase({
      root,
      issueId: "G-RW1",
      toPhase: "specify",
      reason: "missing scenario discovered",
    });

    expect(result.fromPhase).toBe("implement");
    expect(result.toPhase).toBe("specify");

    const stateFile = join(root, ".gxpm", "issues", "G-RW1", "state.json");
    const after = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(after.currentPhase).toBe("specify");
    // Last phaseHistory entry records the rewind
    const last = after.phaseHistory[after.phaseHistory.length - 1];
    expect(last.phase).toBe("specify");
    expect(last.fromPhase).toBe("implement");

    // events.jsonl contains phase.rewound with reason
    const events = readFileSync(
      join(root, ".gxpm", "issues", "G-RW1", "events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const evt = events.find((e) => e.type === "phase.rewound");
    expect(evt).toBeDefined();
    expect(evt.payload.fromPhase).toBe("implement");
    expect(evt.payload.toPhase).toBe("specify");
    expect(evt.payload.reason).toBe("missing scenario discovered");

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects rewind to a phase never entered", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-rewind-never-"));
    setupIssueWithHistory(root, "G-RW2", ["triage", "plan", "dispatch"]);
    expect(() =>
      rewindPhase({ root, issueId: "G-RW2", toPhase: "specify", reason: "test" }),
    ).toThrow(/phaseHistory does not contain/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects empty reason", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-rewind-noreason-"));
    setupIssueWithHistory(root, "G-RW3", ["triage", "plan", "dispatch", "specify", "implement"]);
    expect(() =>
      rewindPhase({ root, issueId: "G-RW3", toPhase: "specify", reason: "" }),
    ).toThrow(/--reason/);
    expect(() =>
      rewindPhase({ root, issueId: "G-RW3", toPhase: "specify", reason: "   " }),
    ).toThrow(/--reason/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects rewind when already in target phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-rewind-same-"));
    setupIssueWithHistory(root, "G-RW4", ["triage", "plan", "specify"]);
    expect(() =>
      rewindPhase({ root, issueId: "G-RW4", toPhase: "specify", reason: "x" }),
    ).toThrow(/already in phase/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects invalid phase name", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-rewind-invalid-"));
    setupIssueWithHistory(root, "G-RW5", ["triage", "plan"]);
    expect(() =>
      rewindPhase({ root, issueId: "G-RW5", toPhase: "nonsense", reason: "x" }),
    ).toThrow(/Invalid phase/);
    rmSync(root, { recursive: true, force: true });
  });
});
