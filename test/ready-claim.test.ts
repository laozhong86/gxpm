import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, readIssueState } from "../core/state";
import {
  claimIssue,
  classifyIssueReadiness,
  listReadyIssues,
  reconcileIssueClaim,
  releaseIssueClaim,
} from "../core/issue-readiness";
import { appendRunEvent, startRun } from "../core/runs";
import { dryRunOrchestratorTick } from "../core/orchestrator";
import { enterPhase, output, runCli, runCliWithEnv } from "./helpers/workflow";

function events(root: string, issueId: string) {
  return readFileSync(join(root, ".gxpm", "issues", issueId, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("issue readiness", () => {
  test("lists only unclaimed implement-phase feature issues with dispatch handoff", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-list-"));
    enterPhase(root, "GXPM-READY", "implement");
    createIssueState({ root, issueId: "GXPM-TRIAGE" });
    enterPhase(root, "GXPM-META", "implement");

    const metaStatePath = join(root, ".gxpm", "issues", "GXPM-META", "state.json");
    const metaState = readIssueState({ root, issueId: "GXPM-META" });
    writeFileSync(metaStatePath, `${JSON.stringify({ ...metaState, issueType: "meta" }, null, 2)}\n`);

    expect(listReadyIssues({ root }).map((issue) => issue.issueId)).toEqual(["GXPM-READY"]);
    expect(classifyIssueReadiness({ root, issueId: "GXPM-READY" })).toMatchObject({
      decision: "ready",
      reason: "ready_for_run",
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-TRIAGE" })).toMatchObject({
      decision: "blocked",
      reason: "phase_triage_not_implement",
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-META" })).toMatchObject({
      decision: "ignored",
      reason: "issue_type_meta",
    });
  });

  test("claim records explicit execution claim and is idempotent for the same session", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-"));
    enterPhase(root, "GXPM-CLAIM", "implement");

    const first = claimIssue({
      root,
      issueId: "GXPM-CLAIM",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });
    const second = claimIssue({
      root,
      issueId: "GXPM-CLAIM",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(readIssueState({ root, issueId: "GXPM-CLAIM" }).claim).toMatchObject({
      status: "claimed",
      actor: "worker-a",
      claimedBySession: "codex:session-a",
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-CLAIM" })).toMatchObject({
      decision: "blocked",
      reason: "claimed_by_session",
    });
    expect(events(root, "GXPM-CLAIM").filter((event) => event.type === "issue.claimed")).toHaveLength(1);
  });

  test("claim refuses issues already claimed by another session", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-conflict-"));
    enterPhase(root, "GXPM-CONFLICT", "implement");
    claimIssue({
      root,
      issueId: "GXPM-CONFLICT",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });

    expect(() =>
      claimIssue({
        root,
        issueId: "GXPM-CONFLICT",
        actor: "worker-b",
        sessionId: "codex:session-b",
      }),
    ).toThrow("Issue already claimed: GXPM-CONFLICT by codex:session-a");
  });

  test("claim refuses when another local claim mutation holds the lock", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-lock-"));
    enterPhase(root, "GXPM-LOCK", "implement");
    writeFileSync(join(root, ".gxpm", "issues", "GXPM-LOCK", ".claim.lock"), "held\n");

    expect(() =>
      claimIssue({
        root,
        issueId: "GXPM-LOCK",
        actor: "worker-a",
        sessionId: "codex:session-a",
      }),
    ).toThrow("Issue claim locked: GXPM-LOCK");
  });

  test("release records the claim outcome and makes the issue ready again", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-release-"));
    enterPhase(root, "GXPM-RELEASE", "implement");
    claimIssue({
      root,
      issueId: "GXPM-RELEASE",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });

    const released = releaseIssueClaim({
      root,
      issueId: "GXPM-RELEASE",
      reason: "handoff_complete",
      sessionId: "codex:session-b",
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(released).toMatchObject({
      released: true,
      claim: {
        status: "released",
        releasedBySession: "codex:session-b",
        releaseReason: "handoff_complete",
      },
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-RELEASE" })).toMatchObject({
      decision: "ready",
      reason: "claim_released",
      claim: { status: "released" },
    });
    expect(events(root, "GXPM-RELEASE").map((event) => event.type)).toContain("issue.claim.released");
  });

  test("reconcile marks old claims stale until an explicit release", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-stale-"));
    enterPhase(root, "GXPM-STALE", "implement");
    claimIssue({
      root,
      issueId: "GXPM-STALE",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });
    const statePath = join(root, ".gxpm", "issues", "GXPM-STALE", "state.json");
    const state = readIssueState({ root, issueId: "GXPM-STALE" });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        { ...state, claim: state.claim ? { ...state.claim, claimedAt: "2026-04-28T00:00:00.000Z" } : state.claim },
        null,
        2,
      )}\n`,
    );

    expect(
      classifyIssueReadiness({
        root,
        issueId: "GXPM-STALE",
        now: "2026-04-30T00:00:00.000Z",
        staleAfterMs: 60 * 60 * 1000,
      }),
    ).toMatchObject({
      decision: "blocked",
      reason: "stale_claim",
      claim: { status: "claimed" },
    });

    const reconciled = reconcileIssueClaim({
      root,
      issueId: "GXPM-STALE",
      sessionId: "codex:reconciler",
      now: "2026-04-30T00:00:00.000Z",
      staleAfterMs: 60 * 60 * 1000,
    });

    expect(reconciled).toMatchObject({
      reconciled: true,
      action: "marked_stale",
      reason: "claim_age_exceeded",
      claim: { status: "stale" },
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-STALE" })).toMatchObject({
      decision: "blocked",
      reason: "stale_claim",
      claim: { status: "stale" },
    });

    releaseIssueClaim({
      root,
      issueId: "GXPM-STALE",
      reason: "stale_claim_released",
      sessionId: "codex:reconciler",
      now: "2026-04-30T00:01:00.000Z",
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-STALE" })).toMatchObject({
      decision: "ready",
      reason: "claim_released",
    });
  });

  test("reconcile releases claims linked to terminal runs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-claim-terminal-run-"));
    enterPhase(root, "GXPM-RUN", "implement");
    const run = startRun({ root, issueId: "GXPM-RUN", workspacePath: "/tmp/gxpm-run" });
    claimIssue({
      root,
      issueId: "GXPM-RUN",
      actor: "worker-a",
      sessionId: "codex:session-a",
      runId: run.runId,
    });
    appendRunEvent({
      root,
      issueId: "GXPM-RUN",
      runId: run.runId,
      type: "run.succeeded",
      status: "succeeded",
    });

    expect(classifyIssueReadiness({ root, issueId: "GXPM-RUN" })).toMatchObject({
      decision: "blocked",
      reason: "claim_run_succeeded_needs_reconcile",
    });

    expect(
      reconcileIssueClaim({
        root,
        issueId: "GXPM-RUN",
        sessionId: "codex:reconciler",
        now: "2026-04-30T00:00:00.000Z",
      }),
    ).toMatchObject({
      reconciled: true,
      action: "released",
      reason: "run_succeeded",
      claim: {
        status: "released",
        releaseReason: "run_succeeded",
        runId: run.runId,
      },
    });
    expect(classifyIssueReadiness({ root, issueId: "GXPM-RUN" })).toMatchObject({
      decision: "ready",
      reason: "claim_released",
    });
  });

  test("orchestrator dry-run treats claimed issues as blocked", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-orch-claimed-"));
    enterPhase(root, "GXPM-CLAIMED", "implement");
    claimIssue({
      root,
      issueId: "GXPM-CLAIMED",
      actor: "worker-a",
      sessionId: "codex:session-a",
    });

    const report = dryRunOrchestratorTick({ root, includeAll: true });

    expect(report.summary).toEqual({ dispatchable: 0, blocked: 1, ignored: 0 });
    expect(report.issues[0]).toMatchObject({
      issueId: "GXPM-CLAIMED",
      decision: "blocked",
      reason: "claimed_by_session",
    });
  });
});

describe("issue ready/claim CLI", () => {
  test("prints ready issues as JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ready-cli-"));
    enterPhase(root, "GXPM-CLI", "implement");

    const result = runCli(root, ["issue", "ready", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output(result))).toEqual([
      expect.objectContaining({
        issueId: "GXPM-CLI",
        decision: "ready",
        reason: "ready_for_run",
      }),
    ]);
  });

  test("claims the next ready issue using current session identity", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-claim-cli-"));
    enterPhase(root, "GXPM-NEXT", "implement");

    const result = runCliWithEnv(root, ["issue", "claim", "--next", "--actor", "worker-cli", "--json"], {
      CODEX_COMPANION_SESSION_ID: "claim-cli",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output(result))).toMatchObject({
      issueId: "GXPM-NEXT",
      claimed: true,
      claim: {
        actor: "worker-cli",
        claimedBySession: "codex:claim-cli",
      },
    });
  });

  test("releases and reconciles claims from the CLI", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-claim-cli-release-"));
    enterPhase(root, "GXPM-CLI-RELEASE", "implement");
    expect(runCli(root, ["issue", "claim", "GXPM-CLI-RELEASE", "--actor", "worker-cli"]).exitCode).toBe(0);

    const release = runCli(root, [
      "issue",
      "release",
      "GXPM-CLI-RELEASE",
      "--reason",
      "manual_cli_release",
      "--json",
    ]);
    expect(release.exitCode).toBe(0);
    expect(JSON.parse(output(release))).toMatchObject({
      released: true,
      claim: {
        status: "released",
        releaseReason: "manual_cli_release",
      },
    });

    const reconcile = runCli(root, ["issue", "reconcile-claim", "GXPM-CLI-RELEASE", "--json"]);
    expect(reconcile.exitCode).toBe(0);
    expect(JSON.parse(output(reconcile))).toMatchObject({
      reconciled: false,
      action: "none",
      reason: "claim_released",
    });
  });

  test("rejects ambiguous --next and explicit issue claim targets", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-claim-cli-mixed-"));
    enterPhase(root, "GXPM-MIXED", "implement");

    const result = runCli(root, ["issue", "claim", "GXPM-MIXED", "--next"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("choose either `gxpm issue claim <issue-id>` or `gxpm issue claim --next`");
  });

  test("rejects --actor without a value", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-claim-cli-actor-"));
    enterPhase(root, "GXPM-ACTOR", "implement");

    const result = runCli(root, ["issue", "claim", "GXPM-ACTOR", "--actor"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("--actor requires a value");
  });
});
