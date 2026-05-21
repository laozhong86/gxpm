import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializePrCheck } from "../core/pr-check";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("pr-check gate", () => {
  test("initializes pr check only in ship phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-pr-check-init-"));
    createIssueState({ root, issueId: "GXPM-100" });

    expect(() => initializePrCheck({ root, issueId: "GXPM-100" })).toThrow(
      "PR check can only be initialized from ship phase",
    );

    enterPhase(root, "GXPM-101", "ship");
    const artifact = initializePrCheck({ root, issueId: "GXPM-101" });

    expect(artifact.type).toBe("pr-check");
    expect(readArtifact({ root, issueId: "GXPM-101", type: "pr-check" }).payload).toEqual({
      pullRequest: "",
      reviewFindings: [],
      risks: [],
      shipReadinessArtifact: "ship-readiness",
      status: "draft",
      summary: "",
    });
  });

  test("blocks ship to pr-check until pr check exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-pr-check-gate-"));
    enterPhase(root, "GXPM-102", "ship");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-102", nextPhase: "pr-check" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-102", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "pr-check" },
    });

    initializePrCheck({ root, issueId: "GXPM-102" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-102", nextPhase: "pr-check" });

    expect(state.currentPhase).toBe("pr-check");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-102", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.findLast((e) => e.type === "gate.passed")).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "pr-check" },
    });
  });

  test("CLI supports pr check init and artifact-backed pr-check transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-pr-check-cli-"));
    enterPhaseCli(root, "GXPM-103", "ship");

    const blocked = runCli(root, ["issue", "transition", "GXPM-103", "pr-check"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm ship pr-check GXPM-103");

    const prCheck = runCli(root, ["ship", "pr-check", "GXPM-103"]);
    expect(prCheck.exitCode).toBe(0);
    expect(output(prCheck)).toContain("initialized pr check artifact for GXPM-103");

    const list = runCli(root, ["artifact", "list", "GXPM-103"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("ship-readiness");
    expect(output(list)).toContain("pr-check");

    const read = runCli(root, ["artifact", "read", "GXPM-103", "pr-check"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-103", "pr-check"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-103: ship -> pr-check");
  });
});
