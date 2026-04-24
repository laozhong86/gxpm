import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
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

function enterDispatch(root: string, issueId: string) {
  createIssueState({ root, issueId });
  initializeTriage({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "plan" });
  initializePlan({ root, issueId });
  transitionIssuePhase({ root, issueId, nextPhase: "dispatch" });
}

describe("dispatch gate", () => {
  test("initializes dispatch handoff only in dispatch phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-init-"));
    createIssueState({ root, issueId: "GXPM-50" });

    expect(() => initializeDispatch({ root, issueId: "GXPM-50" })).toThrow(
      "Dispatch can only be initialized from dispatch phase",
    );

    enterDispatch(root, "GXPM-51");
    const artifact = initializeDispatch({ root, issueId: "GXPM-51" });

    expect(artifact.type).toBe("dispatch-handoff");
    expect(readArtifact({ root, issueId: "GXPM-51", type: "dispatch-handoff" }).payload).toEqual({
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "draft",
      stopRule: "",
      targetBranch: "",
      validation: [],
      worktreePath: "",
      workerTasks: [],
    });
  });

  test("blocks dispatch to implement until dispatch handoff exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-gate-"));
    enterDispatch(root, "GXPM-52");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-52", nextPhase: "implement" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-52", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "dispatch-handoff" },
    });

    initializeDispatch({ root, issueId: "GXPM-52" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-52", nextPhase: "implement" });

    expect(state.currentPhase).toBe("implement");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-52", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "dispatch-handoff" },
    });
  });

  test("CLI supports dispatch init and artifact-backed implement transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-53"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-53"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-53", "plan"]).exitCode).toBe(0);
    expect(runCli(root, ["plan", "init", "GXPM-53"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-53", "dispatch"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-53", "implement"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm dispatch init GXPM-53");

    const dispatch = runCli(root, ["dispatch", "init", "GXPM-53"]);
    expect(dispatch.exitCode).toBe(0);
    expect(output(dispatch)).toContain("initialized dispatch handoff for GXPM-53");

    const list = runCli(root, ["artifact", "list", "GXPM-53"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("implementation-plan");
    expect(output(list)).toContain("dispatch-handoff");

    const read = runCli(root, ["artifact", "read", "GXPM-53", "dispatch-handoff"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-53", "implement"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-53: dispatch -> implement");
  });
});
