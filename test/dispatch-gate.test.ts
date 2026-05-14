import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { confirmSpecify, initializeSpecify } from "../core/specify";
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

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-52", nextPhase: "specify" })).toThrow(
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
    const state = transitionIssuePhase({ root, issueId: "GXPM-52", nextPhase: "specify" });

    expect(state.currentPhase).toBe("specify");
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

    const blocked = runCli(root, ["issue", "transition", "GXPM-53", "specify"]);
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

    const toSpecify = runCli(root, ["issue", "transition", "GXPM-53", "specify"]);
    expect(toSpecify.exitCode).toBe(0);
    expect(output(toSpecify)).toContain("transitioned GXPM-53: dispatch -> specify");

    // Complete the specify phase: init the behavior-spec, fill placeholders, confirm
    initializeSpecify({ root, issueId: "GXPM-53" });
    const specPath = join(root, ".gxpm", "issues", "GXPM-53", "artifacts", "behavior-spec.json");
    const stored = JSON.parse(readFileSync(specPath, "utf8"));
    stored.payload.feature = { title: "test feature", asA: "user", iWant: "outcome", soThat: "tests pass" };
    const stubRel = `test/.gxpm-fixtures/GXPM-53.test.ts`;
    stored.payload.scenarios = [{
      id: "scn-01", name: "test scenario", given: ["a precondition"],
      when: "an action occurs", then: ["an outcome appears"],
      examples: [], stubPath: stubRel,
    }];
    writeFileSync(specPath, `${JSON.stringify(stored, null, 2)}\n`);
    const stubAbs = join(root, stubRel);
    mkdirSync(join(stubAbs, ".."), { recursive: true });
    writeFileSync(stubAbs, "// stub\n");
    confirmSpecify({ root, issueId: "GXPM-53", confirmedBy: "test@gxpm" });

    const toImplement = runCli(root, ["issue", "transition", "GXPM-53", "implement"]);
    expect(toImplement.exitCode).toBe(0);
    expect(output(toImplement)).toContain("transitioned GXPM-53: specify -> implement");
  });

  test("auto-creates worktree on dispatch to specify transition in a git repo", () => {
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

    const transition = runCli(root, ["issue", "transition", "GXPM-54", "specify"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-54: dispatch -> specify");
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

    const transition = runCli(root, ["issue", "transition", "GXPM-55", "specify"]);
    expect(transition.exitCode).toBe(1);
    expect(output(transition)).toContain("Transition blocked");
    expect(output(transition)).toContain("git worktree");
  });

  test("auto-populates dispatch handoff from upstream artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-auto-"));
    enterPhase(root, "GXPM-60", "dispatch");

    // Seed upstream artifacts with realistic data
    writeArtifact({
      root,
      issueId: "GXPM-60",
      type: "implementation-plan",
      payload: {
        steps: ["Refactor dispatch.ts", "Add tests", "Run validation"],
        validation: ["All gates pass", "No regressions"],
        risks: ["Breaking existing CLI behavior"],
      },
    });
    writeArtifact({
      root,
      issueId: "GXPM-60",
      type: "triage-report",
      payload: {
        nonGoals: ["Refactor unrelated modules", "Add new dependencies"],
      },
    });

    initializeDispatch({ root, issueId: "GXPM-60" });
    const handoff = readArtifact({ root, issueId: "GXPM-60", type: "dispatch-handoff" }).payload as Record<
      string,
      unknown
    >;

    expect(handoff.workerTasks).toEqual([
      { id: "task-001", description: "Refactor dispatch.ts", status: "pending" },
      { id: "task-002", description: "Add tests", status: "pending" },
      { id: "task-003", description: "Run validation", status: "pending" },
    ]);
    expect(handoff.validation).toEqual(["All gates pass", "No regressions"]);
    expect(handoff.stopRule).toBe(
      "Breaking existing CLI behavior; Refactor unrelated modules; Add new dependencies",
    );
  });

  test("gracefully handles missing upstream artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-missing-"));
    enterPhase(root, "GXPM-61", "dispatch");

    // Do not seed any upstream artifacts — implementation-plan may exist from enterPhase with empty payload
    initializeDispatch({ root, issueId: "GXPM-61" });
    const handoff = readArtifact({ root, issueId: "GXPM-61", type: "dispatch-handoff" }).payload as Record<
      string,
      unknown
    >;

    expect(handoff.workerTasks).toEqual([]);
    expect(handoff.validation).toEqual([]);
    expect(handoff.stopRule).toBe("");
  });

  test("filters empty strings and whitespace-only entries from upstream arrays", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dispatch-filter-"));
    enterPhase(root, "GXPM-62", "dispatch");

    writeArtifact({
      root,
      issueId: "GXPM-62",
      type: "implementation-plan",
      payload: {
        steps: ["Valid step", "", "  ", null, 42, "Another valid step"],
        validation: ["Check A", "", "Check B", "   "],
        risks: ["Risk 1", "", "Risk 2", "  "],
      },
    });
    writeArtifact({
      root,
      issueId: "GXPM-62",
      type: "triage-report",
      payload: {
        nonGoals: ["", "Non-goal 1", "  ", "Non-goal 2", null],
      },
    });

    initializeDispatch({ root, issueId: "GXPM-62" });
    const handoff = readArtifact({ root, issueId: "GXPM-62", type: "dispatch-handoff" }).payload as Record<
      string,
      unknown
    >;

    expect(handoff.workerTasks).toEqual([
      { id: "task-001", description: "Valid step", status: "pending" },
      { id: "task-002", description: "Another valid step", status: "pending" },
    ]);
    expect(handoff.validation).toEqual(["Check A", "Check B"]);
    expect(handoff.stopRule).toBe("Risk 1; Risk 2; Non-goal 1; Non-goal 2");
  });
});
