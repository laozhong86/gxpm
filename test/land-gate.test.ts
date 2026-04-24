import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeLandFindings } from "../core/land";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("land gate", () => {
  test("initializes land findings only in QA phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-init-"));
    createIssueState({ root, issueId: "GXPM-130" });

    expect(() => initializeLandFindings({ root, issueId: "GXPM-130" })).toThrow(
      "Land findings can only be initialized from qa phase",
    );

    enterPhase(root, "GXPM-131", "qa");
    const artifact = initializeLandFindings({ root, issueId: "GXPM-131" });

    expect(artifact.type).toBe("land-findings");
    expect(readArtifact({ root, issueId: "GXPM-131", type: "land-findings" }).payload).toEqual({
      landReady: false,
      mergePlan: "",
      qaFindingsArtifact: "qa-findings",
      releaseRisks: [],
      status: "draft",
      summary: "",
    });
  });

  test("blocks QA to land until land findings exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-gate-"));
    enterPhase(root, "GXPM-132", "qa");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-132", nextPhase: "land" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-132", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "land-findings" },
    });

    initializeLandFindings({ root, issueId: "GXPM-132" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-132", nextPhase: "land" });

    expect(state.currentPhase).toBe("land");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-132", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "land-findings" },
    });
  });

  test("CLI supports land findings init and artifact-backed land transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-cli-"));
    enterPhaseCli(root, "GXPM-133", "qa");

    const blocked = runCli(root, ["issue", "transition", "GXPM-133", "land"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm qa land GXPM-133");

    const land = runCli(root, ["qa", "land", "GXPM-133"]);
    expect(land.exitCode).toBe(0);
    expect(output(land)).toContain("initialized land findings artifact for GXPM-133");

    const list = runCli(root, ["artifact", "list", "GXPM-133"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("qa-findings");
    expect(output(list)).toContain("land-findings");

    const read = runCli(root, ["artifact", "read", "GXPM-133", "land-findings"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-133", "land"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-133: qa -> land");
  });
});
