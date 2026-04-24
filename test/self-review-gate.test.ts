import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializeAcceptanceCheck } from "../core/ac-check";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializePlan } from "../core/plan";
import { initializeSelfReview } from "../core/self-review";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { initializeTriage } from "../core/triage";

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

function enterAcCheck(root: string, issueId: string) {
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
}

describe("self-review gate", () => {
  test("initializes self review only in ac-check phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-self-review-init-"));
    createIssueState({ root, issueId: "GXPM-80" });

    expect(() => initializeSelfReview({ root, issueId: "GXPM-80" })).toThrow(
      "Self review can only be initialized from ac-check phase",
    );

    enterAcCheck(root, "GXPM-81");
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
    enterAcCheck(root, "GXPM-82");

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
    expect(runCli(root, ["issue", "create", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-83", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-83", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-83", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-83", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-83"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-83", "ac-check"]).exitCode).toBe(0);

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
