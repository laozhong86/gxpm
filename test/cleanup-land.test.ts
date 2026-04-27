import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifact } from "../core/artifacts";
import { appendIssueEvent, createIssueState, getIssuePaths, transitionIssuePhase, type GxpmPhase } from "../core/state";
import { PHASE_ARTIFACT_COMMANDS } from "../scripts/phase-artifact-commands";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { enterPhase, output, runCli } from "./helpers/workflow";

describe("cleanup land command", () => {
  test("dry-run prints WOULD REMOVE and WOULD DELETE lines", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-dry-run-"));
    enterLandedIssue(root, "GXPM-700");

    const result = runCli(root, ["cleanup", "land", "GXPM-700"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("WOULD REMOVE worktree:");
    expect(output(result)).toContain("WOULD DELETE branch:");
  });

  test("refusal-path: phase is not land", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-wrong-phase-"));
    // Set up issue in qa phase (not land) to test phase validation
    enterPhaseManually(root, "GXPM-701", "qa");
    writeArtifact({
      root,
      issueId: "GXPM-701",
      type: "dispatch-handoff",
      payload: {
        inputArtifacts: ["acceptance-contract", "implementation-plan"],
        status: "draft",
        stopRule: "",
        targetBranch: "feature/GXPM-701",
        validation: [],
        worktreePath: "/tmp/gxpm-701",
        workerTasks: [],
        worktree: "gxpm-701",
        branch: "feature/GXPM-701",
      },
    });

    const result = runCli(root, ["cleanup", "land", "GXPM-701"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cleanup only applies to landed issues");
  });

  test("refusal-path: dispatch-handoff missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-missing-handoff-"));
    // Set up issue in land phase, then remove the dispatch-handoff artifact
    enterPhase(root, "GXPM-702", "land");
    rmSync(join(root, ".gxpm", "issues", "GXPM-702", "artifacts", "dispatch-handoff.json"));

    const result = runCli(root, ["cleanup", "land", "GXPM-702"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cleanup requires dispatch-handoff artifact");
  });

  test("execute-path: no cleanup.executed event written when execution fails", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-execute-"));
    enterLandedIssue(root, "GXPM-703");

    const paths = getIssuePaths(root, "GXPM-703");
    // --execute with a nonexistent worktree path will fail at git status or worktree remove
    const result = runCli(root, ["cleanup", "land", "GXPM-703", "--execute"]);

    expect(result.exitCode).toBe(1);

    // Verify no cleanup.executed event was added
    const eventsContent = readFileSync(paths.eventsPath, "utf8");
    const events = eventsContent
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const hasCleanupExecuted = events.some((e: { type: string }) => e.type === "cleanup.executed");
    expect(hasCleanupExecuted).toBe(false);
  });
});

function enterLandedIssue(
  root: string,
  issueId: string,
  payload?: Record<string, unknown>,
) {
  enterPhase(root, issueId, "land");
  writeArtifact({
    root,
    issueId,
    type: "dispatch-handoff",
    payload: payload ?? {
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "draft",
      stopRule: "",
      targetBranch: `feature/${issueId}`,
      validation: [],
      worktreePath: `/tmp/${issueId}`,
      workerTasks: [],
      worktree: issueId,
      branch: `feature/${issueId}`,
    },
  });
}

function enterPhaseManually(root: string, issueId: string, targetPhase: GxpmPhase) {
  // Transition issue through workflow phases to reach the target phase.
  // Uses createIssueState, transitionIssuePhase to test phase management helpers.
  createIssueState({ root, issueId });

  if (targetPhase === "triage") {
    return;
  }

  const workflowSteps = PHASE_GATE_RULES.map((rule, index) => ({
    initialize: PHASE_ARTIFACT_COMMANDS[index].initialize,
    nextPhase: rule.nextPhase,
  }));

  for (const step of workflowSteps) {
    step.initialize({ root, issueId });
    transitionIssuePhase({ root, issueId, nextPhase: step.nextPhase });
    if (step.nextPhase === targetPhase) {
      return;
    }
  }

  throw new Error(`Unsupported target phase: ${targetPhase}`);
}
