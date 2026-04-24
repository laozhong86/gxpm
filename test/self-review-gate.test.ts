import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeSelfReview } from "../core/self-review";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("self-review gate", () => {
  test("initializes self review only in ac-check phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-self-review-init-"));
    createIssueState({ root, issueId: "GXPM-80" });

    expect(() => initializeSelfReview({ root, issueId: "GXPM-80" })).toThrow(
      "Self review can only be initialized from ac-check phase",
    );

    enterPhase(root, "GXPM-81", "ac-check");
    const artifact = initializeSelfReview({ root, issueId: "GXPM-81" });

    expect(artifact.type).toBe("self-review");
    expect(readArtifact({ root, issueId: "GXPM-81", type: "self-review" }).payload).toEqual({
      findings: [],
      reviewedArtifacts: ["acceptance-check", "local-verify"],
      risks: [],
      status: "draft",
      summary: "",
    });
  });

  test("blocks ac-check to self-review until self review exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-self-review-gate-"));
    enterPhase(root, "GXPM-82", "ac-check");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-82", nextPhase: "self-review" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-82", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "self-review" },
    });

    initializeSelfReview({ root, issueId: "GXPM-82" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-82", nextPhase: "self-review" });

    expect(state.currentPhase).toBe("self-review");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-82", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "self-review" },
    });
  });

  test("CLI supports self review init and artifact-backed self-review transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-self-review-cli-"));
    enterPhaseCli(root, "GXPM-83", "ac-check");

    const blocked = runCli(root, ["issue", "transition", "GXPM-83", "self-review"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm ac-check self-review GXPM-83");

    const selfReview = runCli(root, ["ac-check", "self-review", "GXPM-83"]);
    expect(selfReview.exitCode).toBe(0);
    expect(output(selfReview)).toContain("initialized self review artifact for GXPM-83");

    const list = runCli(root, ["artifact", "list", "GXPM-83"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-check");
    expect(output(list)).toContain("self-review");

    const read = runCli(root, ["artifact", "read", "GXPM-83", "self-review"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-83", "self-review"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-83: ac-check -> self-review");
  });
});
