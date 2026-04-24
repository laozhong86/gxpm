import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializeAcceptanceCheck } from "../core/ac-check";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializeLandFindings } from "../core/land";
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

function enterQa(root: string, issueId: string) {
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
  initializeQaFindings({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "qa" });
}

describe("land gate", () => {
  test("initializes land findings only in QA phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-init-"));
    createIssueState({ root, issueId: "GXPM-130" });

    expect(() => initializeLandFindings({ root, issueId: "GXPM-130" })).toThrow(
      "Land findings can only be initialized from qa phase",
    );

    enterQa(root, "GXPM-131");
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
    enterQa(root, "GXPM-132");

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
    expect(runCli(root, ["issue", "create", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "ac-check"]).exitCode).toBe(0);
    expect(runCli(root, ["ac-check", "self-review", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "self-review"]).exitCode).toBe(0);
    expect(runCli(root, ["self-review", "ship", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "ship"]).exitCode).toBe(0);
    expect(runCli(root, ["ship", "pr-check", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "pr-check"]).exitCode).toBe(0);
    expect(runCli(root, ["pr-check", "verify", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "verify"]).exitCode).toBe(0);
    expect(runCli(root, ["verify", "qa", "GXPM-133"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-133", "qa"]).exitCode).toBe(0);

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
