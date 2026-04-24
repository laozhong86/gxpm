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

function enterSelfReview(root: string, issueId: string) {
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
}

describe("ship gate", () => {
  test("initializes ship readiness only in self-review phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-init-"));
    createIssueState({ root, issueId: "GXPM-90" });

    expect(() => initializeShipReadiness({ root, issueId: "GXPM-90" })).toThrow(
      "Ship readiness can only be initialized from self-review phase",
    );

    enterSelfReview(root, "GXPM-91");
    const artifact = initializeShipReadiness({ root, issueId: "GXPM-91" });

    expect(artifact.type).toBe("ship-readiness");
    expect(readArtifact({ root, issueId: "GXPM-91", type: "ship-readiness" }).payload).toEqual({
      checklist: [],
      releaseNotes: "",
      reviewedArtifacts: ["self-review", "acceptance-check"],
      risks: [],
      status: "draft",
      summary: "",
      targetBranch: "",
    });
  });

  test("blocks self-review to ship until ship readiness exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-gate-"));
    enterSelfReview(root, "GXPM-92");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-92", nextPhase: "ship" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-92", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "ship-readiness" },
    });

    initializeShipReadiness({ root, issueId: "GXPM-92" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-92", nextPhase: "ship" });

    expect(state.currentPhase).toBe("ship");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-92", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "ship-readiness" },
    });
  });

  test("CLI supports ship readiness init and artifact-backed ship transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "local-verify"]).exitCode).toBe(0);
    expect(runCli(root, ["local-verify", "ac-check", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "ac-check"]).exitCode).toBe(0);
    expect(runCli(root, ["ac-check", "self-review", "GXPM-93"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-93", "self-review"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-93", "ship"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm self-review ship GXPM-93");

    const ship = runCli(root, ["self-review", "ship", "GXPM-93"]);
    expect(ship.exitCode).toBe(0);
    expect(output(ship)).toContain("initialized ship readiness artifact for GXPM-93");

    const list = runCli(root, ["artifact", "list", "GXPM-93"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("self-review");
    expect(output(list)).toContain("ship-readiness");

    const read = runCli(root, ["artifact", "read", "GXPM-93", "ship-readiness"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-93", "ship"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-93: self-review -> ship");
  });
});
