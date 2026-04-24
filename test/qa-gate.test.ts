import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializeAcceptanceCheck } from "../core/ac-check";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializePlan } from "../core/plan";
import { initializePrCheck } from "../core/pr-check";
import { initializeQaFindings } from "../core/qa";
import { initializeSelfReview } from "../core/self-review";
import { initializeShipReadiness } from "../core/ship";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { initializeTriage } from "../core/triage";
import { initializeVerifyFindings } from "../core/verify";

const cliPath = resolve(import.meta.dir, "..", "scripts", "gxpm.ts");

function runCli(root: string, args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result: ReturnType<typeof runCli>) {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

function enterVerify(root: string, issueId: string) {
  createIssueState({ root, issueId });
  initializeTriage({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "plan" });
  initializePlan({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "dispatch" });
  initializeDispatch({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "implement" });
  initializeLocalVerify({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "local-verify" });
  initializeAcceptanceCheck({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "ac-check" });
  initializeSelfReview({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "self-review" });
  initializeShipReadiness({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "ship" });
  initializePrCheck({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "pr-check" });
  initializeVerifyFindings({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "verify" });
}

describe("qa gate", () => {
  test("initializes QA findings only in verify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qa-init-"));
    createIssueState({ root, issueId: "GXPM-120" });

    expect(() => initializeQaFindings({ root, issueId: "GXPM-120" })).toThrow(
      "QA findings can only be initialized from verify phase",
    );

    enterVerify(root, "GXPM-121");
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
    enterVerify(root, "GXPM-122");

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
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "qa-findings" },
    });
  });

  test("CLI supports QA findings init and artifact-backed QA transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qa-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "ac-check"]).exitCode).toBe(0);
    expect(runCli(root, ["ac-check", "self-review", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "self-review"]).exitCode).toBe(0);
    expect(runCli(root, ["self-review", "ship", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "ship"]).exitCode).toBe(0);
    expect(runCli(root, ["ship", "pr-check", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "pr-check"]).exitCode).toBe(0);
    expect(runCli(root, ["pr-check", "verify", "GXPM-123"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-123", "verify"]).exitCode).toBe(0);

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
