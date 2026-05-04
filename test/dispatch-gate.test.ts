import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("dispatch gate", () => {
  test("initializes dispatch handoff only in dispatch phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-init-"));
    createIssueState({ root, issueId: "GXPM-50" });

    expect(() => initializeDispatch({ root, issueId: "GXPM-50" })).toThrow(
      "Dispatch can only be initialized from dispatch phase",
    );

    enterPhase(root, "GXPM-51", "dispatch");
    const artifact = initializeDispatch({ root, issueId: "GXPM-51" });

    expect(artifact.type).toBe("dispatch-handoff");
    expect(readArtifact({ root, issueId: "GXPM-51", type: "dispatch-handoff" }).payload).toEqual({
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "draft",
      stopRule: "",
      targetBranch: "",
      validation: [],
      worktreePath: "",
      worktreeDecision: "pending",
      workerTasks: [],
    });
  });

  test("blocks dispatch to implement until dispatch handoff exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-gate-"));
    enterPhase(root, "GXPM-52", "dispatch");

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
    enterPhaseCli(root, "GXPM-53", "dispatch");

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

  test("auto-creates worktree on dispatch to implement transition in a git repo", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-worktree-"));
    // Initialize git repo on main branch
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    enterPhaseCli(root, "GXPM-54", "dispatch");

    const dispatch = runCli(root, ["dispatch", "init", "GXPM-54"]);
    expect(dispatch.exitCode).toBe(0);

    const transition = runCli(root, ["issue", "transition", "GXPM-54", "implement"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-54: dispatch -> implement");
    expect(output(transition)).toContain("worktree:");
    expect(output(transition)).toContain("branch:");

    const handoff = readArtifact({ root, issueId: "GXPM-54", type: "dispatch-handoff" });
    const payload = handoff.payload as Record<string, unknown>;
    expect(payload.worktreeDecision).toBeOneOf(["created", "reused"]);
    expect(payload.worktreePath).toBeTruthy();
    expect(existsSync(String(payload.worktreePath))).toBe(true);
  });

  test("worktree gate still blocks transition on feature branch in canonical checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-worktree-gate-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    // Create a feature branch in the canonical checkout
    Bun.spawnSync({ cmd: ["git", "checkout", "-b", "feat-55"], cwd: root });

    enterPhaseCli(root, "GXPM-55", "dispatch");
    runCli(root, ["dispatch", "init", "GXPM-55"]);

    const transition = runCli(root, ["issue", "transition", "GXPM-55", "implement"]);
    expect(transition.exitCode).toBe(1);
    expect(output(transition)).toContain("Transition blocked");
    expect(output(transition)).toContain("git worktree");
  });
});
