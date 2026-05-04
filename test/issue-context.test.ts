import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIssueContext } from "../core/issue-context";
import { createIssueState, getIssuePaths, transitionIssuePhase } from "../core/state";
import { writeIssueCheckpoint } from "../core/checkpoint";
import { writeArtifact } from "../core/artifacts";

describe("buildIssueContext", () => {
  test("missing resume returns missing_resume confidence", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-missing-"));
    createIssueState({ root, issueId: "GXPM-100" });

    const context = buildIssueContext({ root, issueId: "GXPM-100" });

    expect(context.confidence).toBe("missing_resume");
    expect(context.confidenceReasons).toContain("no resume packet found");
    expect(context.checkpointExists).toBe(false);
    expect(context.requiredReads).toContain(".gxpm/issues/GXPM-100/state.json");
    expect(context.requiredReads).toContain(".gxpm/issues/GXPM-100/events.jsonl");
    expect(context.agentInstructions.some((i) => i.includes("No resume packet found"))).toBe(true);
  });

  test("fresh resume when packet matches current state", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-fresh-"));
    createIssueState({ root, issueId: "GXPM-101" });
    writeArtifact({ root, issueId: "GXPM-101", type: "acceptance-contract", payload: { objective: "test" } });
    transitionIssuePhase({ root, issueId: "GXPM-101", nextPhase: "plan" });

    writeIssueCheckpoint({
      root,
      issueId: "GXPM-101",
      title: "handoff",
      payload: {
        summary: "Test checkpoint",
        remainingWork: ["step A", "step B"],
      },
    });

    const context = buildIssueContext({ root, issueId: "GXPM-101" });

    expect(context.confidence).toBe("fresh");
    expect(context.confidenceReasons).toContain("resume packet is consistent with current state and events");
    expect(context.checkpointExists).toBe(true);
    expect(context.resumePhase).toBe("plan");
    expect(context.currentPhase).toBe("plan");
    expect(context.agentInstructions.some((i) => i.includes("Resume context is fresh"))).toBe(true);
    expect(context.agentInstructions.some((i) => i.includes("step A"))).toBe(true);
  });

  test("stale_resume when phase differs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-stale-phase-"));
    createIssueState({ root, issueId: "GXPM-102" });
    writeArtifact({ root, issueId: "GXPM-102", type: "acceptance-contract", payload: { objective: "test" } });
    transitionIssuePhase({ root, issueId: "GXPM-102", nextPhase: "plan" });

    writeIssueCheckpoint({
      root,
      issueId: "GXPM-102",
      title: "handoff",
      payload: { summary: "Old checkpoint" },
    });

    writeArtifact({ root, issueId: "GXPM-102", type: "implementation-plan", payload: { summary: "test" } });
    transitionIssuePhase({ root, issueId: "GXPM-102", nextPhase: "dispatch" });

    const context = buildIssueContext({ root, issueId: "GXPM-102" });

    expect(context.confidence).toBe("stale_resume");
    expect(context.confidenceReasons.some((r) => r.includes("plan") && r.includes("dispatch"))).toBe(true);
    expect(context.agentInstructions.some((i) => i.includes("stale"))).toBe(true);
  });

  test("stale_resume when state updated after resume", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-stale-time-"));
    createIssueState({ root, issueId: "GXPM-103" });

    writeIssueCheckpoint({
      root,
      issueId: "GXPM-103",
      title: "handoff",
      payload: { summary: "Early checkpoint" },
    });

    // Simulate a later state update by touching state.json with a future timestamp
    const paths = getIssuePaths(root, "GXPM-103");
    const state = JSON.parse(readFileSync(paths.statePath, "utf8"));
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    state.updatedAt = future;
    writeFileSync(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);

    const context = buildIssueContext({ root, issueId: "GXPM-103" });

    expect(context.confidence).toBe("stale_resume");
    expect(context.confidenceReasons.some((r) => r.includes("updatedAt") && r.includes("newer"))).toBe(true);
  });

  test("invalid_resume when resume packet is malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-invalid-"));
    createIssueState({ root, issueId: "GXPM-104" });

    const paths = getIssuePaths(root, "GXPM-104");
    mkdirSync(join(paths.issueDir, "memory"), { recursive: true });
    writeFileSync(join(paths.issueDir, "memory", "resume-packet.json"), "not json");

    const context = buildIssueContext({ root, issueId: "GXPM-104" });

    expect(context.confidence).toBe("invalid_resume");
    expect(context.confidenceReasons).toContain("resume packet is not valid JSON");
  });

  test("invalid_resume when checkpoint path is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-missing-checkpoint-"));
    createIssueState({ root, issueId: "GXPM-105" });

    const paths = getIssuePaths(root, "GXPM-105");
    mkdirSync(join(paths.issueDir, "memory"), { recursive: true });
    writeFileSync(
      join(paths.issueDir, "memory", "resume-packet.json"),
      JSON.stringify({
        schemaVersion: 1,
        issueId: "GXPM-105",
        phase: "triage",
        title: "x",
        status: "in-progress",
        branch: "main",
        writtenAt: new Date().toISOString(),
        checkpointPath: "memory/checkpoints/never-exists.md",
        summary: "x",
        decisions: [],
        remainingWork: [],
        notes: [],
        filesModified: [],
      }, null, 2) + "\n",
    );

    const context = buildIssueContext({ root, issueId: "GXPM-105" });

    expect(context.confidence).toBe("invalid_resume");
    expect(context.confidenceReasons.some((r) => r.includes("checkpoint path does not exist"))).toBe(true);
  });

  test("requiredReads includes current phase artifact when present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-reads-"));
    createIssueState({ root, issueId: "GXPM-106" });

    writeArtifact({ root, issueId: "GXPM-106", type: "acceptance-contract", payload: { objective: "test" } });

    const context = buildIssueContext({ root, issueId: "GXPM-106" });

    expect(context.requiredReads).toContain(".gxpm/issues/GXPM-106/artifacts/acceptance-contract.json");
  });

  test("next guidance points to the following phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-context-next-"));
    createIssueState({ root, issueId: "GXPM-107" });
    writeArtifact({ root, issueId: "GXPM-107", type: "acceptance-contract", payload: { objective: "test" } });
    transitionIssuePhase({ root, issueId: "GXPM-107", nextPhase: "plan" });

    const context = buildIssueContext({ root, issueId: "GXPM-107" });

    expect(context.next).toContain("dispatch");
    expect(context.next).toContain("gxpm issue transition GXPM-107 dispatch");
  });
});
