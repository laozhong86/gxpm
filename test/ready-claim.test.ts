import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, readIssueState } from "../core/state";
import {
  claimIssue,
  classifyIssueReadiness,
  listReadyIssues,
} from "../core/issue-readiness";
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
});
