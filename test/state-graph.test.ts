import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueState,
  readIssueState,
  transitionIssuePhase,
} from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { initializeTriage } from "../core/triage";

describe("gxpm state graph", () => {
  test("creates a local issue state graph rooted in .gxpm", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-state-"));

    const state = createIssueState({ root, issueId: "GXPM-1" });

    expect(state.currentPhase).toBe("triage");
    expect((state as any).ownership).toMatchObject({
      currentSession: expect.any(String),
      lastTouchedAt: expect.any(String),
    });
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

  test("reads legacy state files without ownership metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-legacy-state-"));
    createIssueState({ root, issueId: "GXPM-4" });

    const statePath = join(root, ".gxpm", "issues", "GXPM-4", "state.json");
    const legacy = JSON.parse(readFileSync(statePath, "utf8"));
    delete legacy.ownership;
    writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const state = readIssueState({ root, issueId: "GXPM-4" }) as any;
    expect(state.currentPhase).toBe("triage");
    expect(state.ownership).toBeUndefined();
  });

  test("reads legacy v1 state files through the migration path", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-legacy-"));
    const issueDir = join(root, ".gxpm", "issues", "GXPM-LEGACY");
    mkdirSync(issueDir, { recursive: true });

    const legacyState = {
      schemaVersion: 1,
      issueId: "GXPM-LEGACY",
      currentPhase: "triage",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      stateRoot: ".gxpm/issues/GXPM-LEGACY",
      artifactRoot: ".gxpm/issues/GXPM-LEGACY/artifacts",
      phaseHistory: [{ phase: "triage", enteredAt: "2025-01-01T00:00:00Z", fromPhase: null }],
    };
    writeFileSync(join(issueDir, "state.json"), `${JSON.stringify(legacyState, null, 2)}\n`);

    const state = readIssueState({ root, issueId: "GXPM-LEGACY" });

    expect(state.issueType).toBe("feature");
    expect(state.currentPhase).toBe("triage");
  });

  test("records session id on phase transition events", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-transition-session-"));
    process.env.CODEX_COMPANION_SESSION_ID = "transition-session";
    createIssueState({ root, issueId: "GXPM-5" });
    writeArtifact({ root, issueId: "GXPM-5", type: "acceptance-contract", payload: {} });

    transitionIssuePhase({ root, issueId: "GXPM-5", nextPhase: "plan" });

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-5", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "phase.transitioned",
      sessionId: "codex:transition-session",
    });
    expect(readIssueState({ root, issueId: "GXPM-5" }) as any).toMatchObject({
      ownership: {
        currentSession: "codex:transition-session",
        lastTouchedAt: expect.any(String),
      },
    });
    delete process.env.CODEX_COMPANION_SESSION_ID;
  });
});
