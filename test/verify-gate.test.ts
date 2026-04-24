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

function enterPrCheck(root: string, issueId: string) {
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
}

describe("verify gate", () => {
  test("initializes verify findings only in pr-check phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-init-"));
    createIssueState({ root, issueId: "GXPM-110" });

    expect(() => initializeVerifyFindings({ root, issueId: "GXPM-110" })).toThrow(
      "Verify findings can only be initialized from pr-check phase",
    );

    enterPrCheck(root, "GXPM-111");
    const artifact = initializeVerifyFindings({ root, issueId: "GXPM-111" });

    expect(artifact.type).toBe("verify-findings");
    expect(readArtifact({ root, issueId: "GXPM-111", type: "verify-findings" }).payload).toEqual({
      acceptanceContractArtifact: "acceptance-contract",
      findings: [],
      prCheckArtifact: "pr-check",
      risks: [],
      status: "draft",
      summary: "",
    });
  });

  test("blocks pr-check to verify until verify findings exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-gate-"));
    enterPrCheck(root, "GXPM-112");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-112", nextPhase: "verify" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-112", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "verify-findings" },
    });

    initializeVerifyFindings({ root, issueId: "GXPM-112" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-112", nextPhase: "verify" });

    expect(state.currentPhase).toBe("verify");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-112", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "verify-findings" },
    });
  });

  test("CLI supports verify findings init and artifact-backed verify transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "ac-check"]).exitCode).toBe(0);
    expect(runCli(root, ["ac-check", "self-review", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "self-review"]).exitCode).toBe(0);
    expect(runCli(root, ["self-review", "ship", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "ship"]).exitCode).toBe(0);
    expect(runCli(root, ["ship", "pr-check", "GXPM-113"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-113", "pr-check"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-113", "verify"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm pr-check verify GXPM-113");

    const verify = runCli(root, ["pr-check", "verify", "GXPM-113"]);
    expect(verify.exitCode).toBe(0);
    expect(output(verify)).toContain("initialized verify findings artifact for GXPM-113");

    const list = runCli(root, ["artifact", "list", "GXPM-113"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("pr-check");
    expect(output(list)).toContain("verify-findings");

    const read = runCli(root, ["artifact", "read", "GXPM-113", "verify-findings"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-113", "verify"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-113: pr-check -> verify");
  });
});
