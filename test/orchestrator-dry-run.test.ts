import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { dryRunOrchestratorTick } from "../core/orchestrator";
import { claimIssue } from "../core/issue-readiness";
import { appendRunEvent, startRun } from "../core/runs";
import { enterPhase, output, runCli } from "./helpers/workflow";

describe("orchestrator dry-run tick", () => {
  test("reports implement-phase feature issues as dispatchable", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-orch-ready-"));
    enterPhase(root, "GXPM-1", "implement");

    const report = dryRunOrchestratorTick({ root });

    expect(report.summary).toEqual({ dispatchable: 1, blocked: 0, ignored: 0 });
    expect(report.issues[0]).toMatchObject({
      issueId: "GXPM-1",
      currentPhase: "implement",
      decision: "dispatchable",
      reason: "ready_for_run",
    });
  });

  test("reports earlier phases as blocked and hides landed issues by default", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-orch-blocked-"));
    createIssueState({ root, issueId: "GXPM-2" });
    enterCompletedLand(root, "GXPM-3");

    const report = dryRunOrchestratorTick({ root });

    expect(report.summary).toEqual({ dispatchable: 0, blocked: 1, ignored: 0 });
    expect(report.issues).toEqual([
      expect.objectContaining({
        issueId: "GXPM-2",
        decision: "blocked",
        reason: "phase_triage_not_implement",
      }),
    ]);

    const withIgnored = dryRunOrchestratorTick({ root, includeAll: true });
    expect(withIgnored.summary.ignored).toBe(1);
    expect(withIgnored.issues.find((issue) => issue.issueId === "GXPM-3")).toMatchObject({
      decision: "ignored",
      reason: "landed",
    });
  });

  test("guards against legacy implement states missing dispatch handoff", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-orch-legacy-"));
    createIssueState({ root, issueId: "GXPM-4" });
    const statePath = join(root, ".gxpm", "issues", "GXPM-4", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.currentPhase = "implement";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const report = dryRunOrchestratorTick({ root });

    expect(report.issues[0]).toMatchObject({
      decision: "blocked",
      reason: "missing_dispatch_handoff",
    });
  });

  test("reports terminal-run claim blockers without mutating state", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-orch-terminal-claim-"));
    enterPhase(root, "GXPM-6", "implement");
    const run = startRun({ root, issueId: "GXPM-6" });
    claimIssue({
      root,
      issueId: "GXPM-6",
      actor: "worker-a",
      sessionId: "codex:session-a",
      runId: run.runId,
    });
    appendRunEvent({
      root,
      issueId: "GXPM-6",
      runId: run.runId,
      type: "run.failed",
      status: "failed",
      failureReason: "validation failed",
    });
    const statePath = join(root, ".gxpm", "issues", "GXPM-6", "state.json");
    const before = readFileSync(statePath, "utf8");

    const report = dryRunOrchestratorTick({ root, includeAll: true });

    expect(report.summary).toEqual({ dispatchable: 0, blocked: 1, ignored: 0 });
    expect(report.issues[0]).toMatchObject({
      issueId: "GXPM-6",
      decision: "blocked",
      reason: "claim_run_failed_needs_reconcile",
    });
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  test("CLI prints text and JSON reports without mutating state", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-orch-cli-"));
    enterPhase(root, "GXPM-5", "implement");
    const before = readFileSync(join(root, ".gxpm", "issues", "GXPM-5", "state.json"), "utf8");

    const text = runCli(root, ["orchestrator", "tick", "--dry-run"]);
    expect(text.exitCode).toBe(0);
    expect(output(text)).toContain("dispatchable=1");
    expect(output(text)).toContain("GXPM-5\timplement\tdispatchable\tready_for_run");

    const json = runCli(root, ["orchestrator", "tick", "--dry-run", "--json"]);
    expect(JSON.parse(output(json)).summary.dispatchable).toBe(1);
    expect(readFileSync(join(root, ".gxpm", "issues", "GXPM-5", "state.json"), "utf8")).toBe(before);
  });
});

function enterCompletedLand(root: string, issueId: string) {
  const sha = initGitCommit(root);
  enterPhase(root, issueId, "land");
  writeArtifact({
    root,
    issueId,
    type: "pr-check",
    payload: {
      status: "approved",
      pullRequest: { url: `https://github.com/example/repo/pull/${issueId}` },
      reviewFindings: [],
    },
  });
  writeArtifact({
    root,
    issueId,
    type: "land-findings",
    payload: {
      landReady: true,
      mergePlan: "merged",
      status: "landed",
      mergedAt: new Date().toISOString(),
      mergedSha: sha,
    },
  });
}

function initGitCommit(root: string) {
  execSync("git init -q", { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  execSync("git add tracked.txt", { cwd: root });
  execSync(
    "git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name='gxpm test' -c user.email='gxpm@example.test' commit -q -m initial",
    { cwd: root },
  );
  return execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
}
