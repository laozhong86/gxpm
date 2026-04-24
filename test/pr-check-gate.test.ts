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

function enterShip(root: string, issueId: string) {
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
}

describe("pr-check gate", () => {
  test("initializes pr check only in ship phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-pr-check-init-"));
    createIssueState({ root, issueId: "GXPM-100" });

    expect(() => initializePrCheck({ root, issueId: "GXPM-100" })).toThrow(
      "PR check can only be initialized from ship phase",
    );

    enterShip(root, "GXPM-101");
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
    enterShip(root, "GXPM-102");

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
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "pr-check" },
    });
  });

  test("CLI supports pr check init and artifact-backed pr-check transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-pr-check-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "ac-check"]).exitCode).toBe(0);
    expect(runCli(root, ["ac-check", "self-review", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "self-review"]).exitCode).toBe(0);
    expect(runCli(root, ["self-review", "ship", "GXPM-103"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-103", "ship"]).exitCode).toBe(0);

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
