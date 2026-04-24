import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeAcceptanceCheck } from "../core/ac-check";
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

function enterLocalVerify(root: string, issueId: string) {
  createIssueState({ root, issueId });
  initializeTriage({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "plan" });
  initializePlan({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "dispatch" });
  initializeDispatch({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "implement" });
  initializeLocalVerify({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "local-verify" });
}

describe("ac-check gate", () => {
  test("initializes acceptance check only in local-verify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-init-"));
    createIssueState({ root, issueId: "GXPM-70" });

    expect(() => initializeAcceptanceCheck({ root, issueId: "GXPM-70" })).toThrow(
      "Acceptance check can only be initialized from local-verify phase",
    );

    enterLocalVerify(root, "GXPM-71");
    const artifact = initializeAcceptanceCheck({ root, issueId: "GXPM-71" });

    expect(artifact.type).toBe("acceptance-check");
    expect(readArtifact({ root, issueId: "GXPM-71", type: "acceptance-check" }).payload).toEqual({
      criteria: [],
      findings: [],
      localVerifyArtifact: "local-verify",
      status: "draft",
      summary: "",
    });
  });

  test("blocks local-verify to ac-check until acceptance check exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-gate-"));
    enterLocalVerify(root, "GXPM-72");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-72", nextPhase: "ac-check" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-72", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "acceptance-check" },
    });

    initializeAcceptanceCheck({ root, issueId: "GXPM-72" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-72", nextPhase: "ac-check" });

    expect(state.currentPhase).toBe("ac-check");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-72", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "acceptance-check" },
    });
  });

  test("CLI supports ac-check init and artifact-backed ac-check transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-73"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-73"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-73", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-73"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-73", "dispatch"]).exitCode).toBe(0);
    expect(runCli(root, ["dispatch", "init", "GXPM-73"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-73", "implement"]).exitCode).toBe(0);
    expect(runCli(root, ["implement", "verify", "GXPM-73"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-73", "local-verify"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-73", "ac-check"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm local-verify ac-check GXPM-73");

    const acCheck = runCli(root, ["local-verify", "ac-check", "GXPM-73"]);
    expect(acCheck.exitCode).toBe(0);
    expect(output(acCheck)).toContain("initialized acceptance check artifact for GXPM-73");

    const list = runCli(root, ["artifact", "list", "GXPM-73"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("local-verify");
    expect(output(list)).toContain("acceptance-check");

    const read = runCli(root, ["artifact", "read", "GXPM-73", "acceptance-check"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-73", "ac-check"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-73: local-verify -> ac-check");
  });
});
