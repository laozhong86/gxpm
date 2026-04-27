import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      plan_lint_findings: {
        hasFindings: false,
        items: [],
      },
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

  test("self-review initializer records plan_lint_findings from codex plan logs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-self-review-plan-lint-"));
    enterPhase(root, "GXPM-84", "ac-check");
    const issueDir = join(root, ".gxpm", "issues", "GXPM-84");
    writeFileSync(
      join(issueDir, "codex-plans.jsonl"),
      JSON.stringify({
        tool_name: "update_plan",
        arguments: { steps: [{ description: "推进到 implement phase" }] },
      }) + "\n",
    );

    initializeSelfReview({ root, issueId: "GXPM-84" });
    const payload = readArtifact({ root, issueId: "GXPM-84", type: "self-review" }).payload as any;

    expect(payload.plan_lint_findings.hasFindings).toBe(true);
    expect(payload.plan_lint_findings.items[0].text).toContain("推进到 implement phase");
    expect(payload.plan_lint_findings.items[0].matchedKeywords).toContain("implement");
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
