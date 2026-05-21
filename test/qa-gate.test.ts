import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeQaFindings } from "../core/qa";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("qa gate", () => {
  test("initializes QA findings only in verify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qa-init-"));
    createIssueState({ root, issueId: "GXPM-120" });

    expect(() => initializeQaFindings({ root, issueId: "GXPM-120" })).toThrow(
      "QA findings can only be initialized from verify phase",
    );

    enterPhase(root, "GXPM-121", "verify");
    const artifact = initializeQaFindings({ root, issueId: "GXPM-121" });

    expect(artifact.type).toBe("qa-findings");
    expect(readArtifact({ root, issueId: "GXPM-121", type: "qa-findings" }).payload).toEqual({
      browserEvidence: [],
      findings: [],
      risks: [],
      status: "draft",
      summary: "",
      verifyFindingsArtifact: "verify-findings",
    });
  });

  test("blocks verify to QA until QA findings exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qa-gate-"));
    enterPhase(root, "GXPM-122", "verify");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-122", nextPhase: "qa" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-122", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "qa-findings" },
    });

    initializeQaFindings({ root, issueId: "GXPM-122" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-122", nextPhase: "qa" });

    expect(state.currentPhase).toBe("qa");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-122", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.findLast((e) => e.type === "gate.passed")).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "qa-findings" },
    });
  });

  test("CLI supports QA findings init and artifact-backed QA transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qa-cli-"));
    enterPhaseCli(root, "GXPM-123", "verify");

    const blocked = runCli(root, ["issue", "transition", "GXPM-123", "qa"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm verify qa GXPM-123");

    const qa = runCli(root, ["verify", "qa", "GXPM-123"]);
    expect(qa.exitCode).toBe(0);
    expect(output(qa)).toContain("initialized QA findings artifact for GXPM-123");

    const list = runCli(root, ["artifact", "list", "GXPM-123"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("verify-findings");
    expect(output(list)).toContain("qa-findings");

    const read = runCli(root, ["artifact", "read", "GXPM-123", "qa-findings"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-123", "qa"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-123: verify -> qa");
  });
});
