import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueState,
  readIssueState,
  transitionIssuePhase,
} from "../core/state";
import { initializeTriage } from "../core/triage";

describe("gxpm state graph", () => {
  test("creates a local issue state graph rooted in .gxpm", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-state-"));

    const state = createIssueState({ root, issueId: "GXPM-1" });

    expect(state.currentPhase).toBe("triage");
    expect(state.issueType).toBe("feature");
    expect(state.phaseHistory).toEqual([
      expect.objectContaining({ phase: "triage", fromPhase: null }),
    ]);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "state.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "graph.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "artifacts", "index.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "events.jsonl"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "reports"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "evidence", "screenshots"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "memory"))).toBe(true);

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-1", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ schemaVersion: 1, type: "issue.created", issueId: "GXPM-1" });
  });

  test("creates explicit issue types without changing the phase graph", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-state-type-"));

    const state = createIssueState({ root, issueId: "GXPM-META", issueType: "meta" });

    expect(state.issueType).toBe("meta");
    expect(state.currentPhase).toBe("triage");
    expect(readIssueState({ root, issueId: "GXPM-META" }).issueType).toBe("meta");
  });

  test("advances to the next phase and records history plus event log", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-transition-"));
    createIssueState({ root, issueId: "GXPM-2" });
    initializeTriage({ root, issueId: "GXPM-2" });

    const state = transitionIssuePhase({ root, issueId: "GXPM-2", nextPhase: "plan" });

    expect(state.currentPhase).toBe("plan");
    expect(readIssueState({ root, issueId: "GXPM-2" }).currentPhase).toBe("plan");
    expect(state.phaseHistory.at(-1)).toEqual(
      expect.objectContaining({ phase: "plan", fromPhase: "triage" }),
    );

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-2", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual([
      "issue.created",
      "artifact.written",
      "gate.passed",
      "phase.transitioned",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "phase.transitioned",
      payload: { fromPhase: "triage", toPhase: "plan" },
    });
  });

  test("rejects skipped phases and duplicate issue creation", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-invalid-"));
    createIssueState({ root, issueId: "GXPM-3" });

    expect(() => createIssueState({ root, issueId: "GXPM-3" })).toThrow("already exists");
    expect(() => transitionIssuePhase({ root, issueId: "GXPM-3", nextPhase: "dispatch" })).toThrow(
      "Invalid phase transition",
    );
    expect(readIssueState({ root, issueId: "GXPM-3" }).currentPhase).toBe("triage");
  });
});
