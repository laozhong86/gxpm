import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializePlan } from "../core/plan";
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

function enterImplement(root: string, issueId: string) {
  createIssueState({ root, issueId });
  initializeTriage({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "plan" });
  initializePlan({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "dispatch" });
  initializeDispatch({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "implement" });
}

describe("implement gate", () => {
  test("initializes local verify only in implement phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-init-"));
    createIssueState({ root, issueId: "GXPM-60" });

    expect(() => initializeLocalVerify({ root, issueId: "GXPM-60" })).toThrow(
      "Local verify can only be initialized from implement phase",
    );

    enterImplement(root, "GXPM-61");
    const artifact = initializeLocalVerify({ root, issueId: "GXPM-61" });

    expect(artifact.type).toBe("local-verify");
    expect(readArtifact({ root, issueId: "GXPM-61", type: "local-verify" }).payload).toEqual({
      changedFiles: [],
      commands: [],
      evidence: [],
      results: [],
      risks: [],
      status: "draft",
    });
  });

  test("blocks implement to local-verify until local verify artifact exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-gate-"));
    enterImplement(root, "GXPM-62");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-62", nextPhase: "local-verify" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-62", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "local-verify" },
    });

    initializeLocalVerify({ root, issueId: "GXPM-62" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-62", nextPhase: "local-verify" });

    expect(state.currentPhase).toBe("local-verify");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-62", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "local-verify" },
    });
  });

  test("CLI supports implement verify and artifact-backed local verify transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-63"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-63"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-63", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-63"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-63", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-63"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-63", "implement"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-63", "local-verify"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm implement verify GXPM-63");

    const verify = runCli(root, ["implement", "verify", "GXPM-63"]);
    expect(verify.exitCode).toBe(0);
    expect(output(verify)).toContain("initialized local verify artifact for GXPM-63");

    const list = runCli(root, ["artifact", "list", "GXPM-63"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("implementation-plan");
    expect(output(list)).toContain("dispatch-handoff");
    expect(output(list)).toContain("local-verify");

    const read = runCli(root, ["artifact", "read", "GXPM-63", "local-verify"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-63", "local-verify"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-63: implement -> local-verify");
  });
});
