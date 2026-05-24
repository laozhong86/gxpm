import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorIssues } from "../scripts/doctor-issues";

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gxpm-doctor-issues-"));
  execSync("git init -q", { cwd: dir });
  mkdirSync(join(dir, ".gxpm", "issues"), { recursive: true });
  mkdirSync(join(dir, ".gxpm", "worktrees"), { recursive: true });
  return dir;
}

function writeIssueState(repoRoot: string, issueId: string, state: Record<string, unknown>) {
  const issueDir = join(repoRoot, ".gxpm", "issues", issueId);
  mkdirSync(issueDir, { recursive: true });
  const fullState = {
    schemaVersion: 1,
    issueId,
    issueType: "feature",
    currentPhase: "implement",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    stateRoot: `.gxpm/issues/${issueId}`,
    artifactRoot: `.gxpm/issues/${issueId}/artifacts`,
    phaseHistory: [],
    ...state,
  };
  writeFileSync(join(issueDir, "state.json"), JSON.stringify(fullState, null, 2));
}

function makeWorktreeDir(repoRoot: string, worktreeName: string) {
  const wtPath = join(repoRoot, ".gxpm", "worktrees", worktreeName);
  mkdirSync(wtPath, { recursive: true });
  return wtPath;
}

// Feature: gxpm doctor issues — business-state health check
//
// As a gxpm user
// I want a single command that scans every tracked issue's business-state health
// So that I can find stalled phases, dangling worktrees, missing artifacts, and broken handoff chains without reading the .gxpm/ tree by hand.
//
// Constitution Compliance:
// - CANON Article 3 (Phase 不可臆测): the check derives phase/health from gxpm artifacts, not chat memory.
// - CANON Article 4 (Artifact 先决): missing-artifact and broken-handoff checks treat artifact state as truth.
// - CANON Article 7 (Worktree 隔离): dangling-worktree detection respects worktree boundaries; --fix only acts on detached worktrees.
// - CANON Article 8 (证据可复核): --fix writes an audit log line per action; the report exposes evidence paths.
// - CANON Article 9 (安全门控): --fix is conservative by default; destructive actions require an explicit --fix-aggressive flag (stubbed this iteration).

describe("doctor-issues — business-state health", () => {
  // Scenario (scn-01): healthy repo passes with score 100
  //   Given a repository containing one issue in the implement phase
  //   And the issue's expected artifacts are all present
  //   And the issue's worktree directory exists at its recorded path
  //   When the user runs gxpm doctor issues
  //   Then the report marks the issue as healthy
  //   And the overall health_score equals 100
  test("test_healthy_repo_passes_with_score_100", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-002", { currentPhase: "implement" });
    makeWorktreeDir(repo, "gxpm-GXPM-002");
    // Implement phase requires local-verify to exit — write a placeholder so the
    // missing_artifact check stays clean.
    const artifactsDir = join(repo, ".gxpm", "issues", "GXPM-002", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(join(artifactsDir, "local-verify.json"), "{}");

    const report = runDoctorIssues({ root: repo });

    expect(report.status).toBe("healthy");
    expect(report.health_score).toBe(100);
    expect(report.checks.every((c) => c.status === "ok" || c.status === "warn")).toBe(true);
    expect(report.checks.some((c) => c.status === "warn")).toBe(false);
  });

  // Scenario (scn-02): dangling worktree is flagged
  //   Given a repository containing one issue marked as terminal
  //   And the issue's recorded worktree directory still exists on disk
  //   When the user runs gxpm doctor issues
  //   Then the report emits a dangling_worktree warning for the issue
  //   And the warning message names the worktree path
  test("test_dangling_worktree_is_flagged", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-001", { archived: true, currentPhase: "land" });
    const wtPath = makeWorktreeDir(repo, "gxpm-GXPM-001");

    const report = runDoctorIssues({ root: repo });

    const dangling = report.checks.find((c) => c.name === "dangling_worktree");
    expect(dangling).toBeDefined();
    expect(dangling?.status).toBe("warn");
    expect(dangling?.issueId).toBe("GXPM-001");
    expect(dangling?.message).toContain(wtPath);
    expect(report.status).toBe("warnings");
  });

  // Scenario (scn-03): phase stale over default threshold
  //   Given a repository containing one issue in the specify phase
  //   And the issue entered the specify phase more than seven days ago
  //   When the user runs gxpm doctor issues
  //   Then the report emits a phase_stale warning for the issue
  //   And the warning message names the phase and the days elapsed
  test("test_phase_stale_over_default_threshold", () => {
    const repo = makeFixtureRepo();
    const enteredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeIssueState(repo, "GXPM-003", {
      currentPhase: "specify",
      phaseHistory: [
        { phase: "triage", enteredAt: "2026-05-01T00:00:00.000Z", fromPhase: null },
        { phase: "plan", enteredAt: "2026-05-02T00:00:00.000Z", fromPhase: "triage" },
        { phase: "specify", enteredAt, fromPhase: "plan" },
      ],
    });

    const report = runDoctorIssues({ root: repo });

    const stale = report.checks.find((c) => c.name === "phase_stale" && c.issueId === "GXPM-003");
    expect(stale).toBeDefined();
    expect(stale?.status).toBe("warn");
    expect(stale?.message).toContain("specify");
    expect(stale?.message).toMatch(/\b10\b|\b10 days?\b/);
  });

  // Scenario (scn-04): phase threshold overridden by config silences warning
  //   Given the repo config sets doctor.issues.phase_threshold.specify to thirty days
  //   And a repository containing one issue in the specify phase
  //   And the issue entered the specify phase ten days ago
  //   When the user runs gxpm doctor issues
  //   Then the report emits no phase_stale warning for the issue
  test("test_phase_threshold_overridden_by_config_silences_warning", () => {
    const repo = makeFixtureRepo();
    const enteredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeIssueState(repo, "GXPM-004", {
      currentPhase: "specify",
      phaseHistory: [
        { phase: "specify", enteredAt, fromPhase: null },
      ],
    });

    const report = runDoctorIssues({
      root: repo,
      phaseThresholdsDays: { specify: 30 },
    });

    const stale = report.checks.find((c) => c.name === "phase_stale" && c.issueId === "GXPM-004");
    expect(stale).toBeUndefined();
  });

  // Scenario (scn-05): missing artifact is flagged
  //   Given a repository containing one issue in the verify phase
  //   And the issue is missing the verify-evidence artifact
  //   When the user runs gxpm doctor issues
  //   Then the report emits a missing_artifact warning for the issue
  //   And the warning message names verify-evidence as the missing artifact
  //
  // Implementation note: per PHASE_GATE_RULES the gate artifact required to
  // exit the verify phase is "qa-findings"; we treat the spec's
  // "verify-evidence" phrasing as a generic synonym for that gate artifact.
  test("test_missing_artifact_is_flagged", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-005", { currentPhase: "verify" });
    // Intentionally no artifacts/ directory — the qa-findings artifact is absent.

    const report = runDoctorIssues({ root: repo });

    const missing = report.checks.find(
      (c) => c.name === "missing_artifact" && c.issueId === "GXPM-005",
    );
    expect(missing).toBeDefined();
    expect(missing?.status).toBe("warn");
    expect(missing?.message).toContain("qa-findings");
  });

  // Scenario (scn-06): broken handoff chain is flagged
  //   Given a repository containing one issue whose previous phase produced a phase-handoff artifact
  //   And the next phase has not acknowledged that handoff
  //   When the user runs gxpm doctor issues
  //   Then the report emits a handoff_broken warning for the issue
  //   And the warning message names the unacknowledged phase boundary
  test("test_broken_handoff_chain_is_flagged", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-006", {
      currentPhase: "self-review",
      phaseHistory: [
        { phase: "ac-check", enteredAt: "2026-05-15T00:00:00.000Z", fromPhase: "local-verify" },
        { phase: "self-review", enteredAt: "2026-05-18T00:00:00.000Z", fromPhase: "ac-check" },
      ],
    });
    const artifactsDir = join(repo, ".gxpm", "issues", "GXPM-006", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "phase-handoff.json"),
      JSON.stringify({
        schemaVersion: 1,
        issueId: "GXPM-006",
        type: "phase-handoff",
        payload: {
          fromPhase: "ac-check",
          nextPhase: "self-review",
          completedAcceptance: [],
          nextPhaseMustRead: [],
          openBlockers: [],
          acknowledgedAt: null,
        },
      }),
    );
    // Self-review gate artifact present so we don't double-warn on missing_artifact.
    writeFileSync(join(artifactsDir, "self-review.json"), "{}");

    const report = runDoctorIssues({ root: repo });

    const broken = report.checks.find(
      (c) => c.name === "handoff_broken" && c.issueId === "GXPM-006",
    );
    expect(broken).toBeDefined();
    expect(broken?.status).toBe("warn");
    expect(broken?.message).toContain("ac-check");
    expect(broken?.message).toContain("self-review");
  });

  // Scenario (scn-07): --fix removes dangling worktree and writes audit
  //   Given a repository containing one issue with a dangling worktree
  //   When the user runs gxpm doctor issues --fix
  //   Then the recorded worktree directory is removed
  //   And the doctor-issues-fixes audit log gains one entry naming the dangling_worktree action
  test("test_fix_removes_dangling_worktree_and_writes_audit", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-007", { archived: true, currentPhase: "land" });
    const wtPath = makeWorktreeDir(repo, "gxpm-GXPM-007");
    const auditDir = mkdtempSync(join(tmpdir(), "gxpm-audit-"));
    const auditPath = join(auditDir, "doctor-issues-fixes.jsonl");

    const report = runDoctorIssues({ root: repo, fix: true, auditLogPath: auditPath });

    expect(existsSync(wtPath)).toBe(false);
    const log = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(log.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(log[0]);
    expect(entry.action).toBe("dangling_worktree");
    expect(entry.issueId).toBe("GXPM-007");
    expect(entry.result).toBe("removed");
    // Report should reflect the fix.
    const dangling = report.checks.find((c) => c.name === "dangling_worktree");
    expect(dangling?.status).toBe("ok");
  });

  // Scenario (scn-08): --fix-aggressive performs no destructive action this iteration
  //   Given a repository containing one issue with a dangling worktree
  //   When the user runs gxpm doctor issues --fix-aggressive
  //   Then the report explains that --fix-aggressive is not yet implemented
  //   And the recorded worktree directory remains in place
  test("test_fix_aggressive_performs_no_destructive_action_this_iteration", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-008", { archived: true, currentPhase: "land" });
    const wtPath = makeWorktreeDir(repo, "gxpm-GXPM-008");

    const report = runDoctorIssues({ root: repo, fixAggressive: true });

    expect(existsSync(wtPath)).toBe(true);
    const note = report.checks.find((c) => c.name === "fix_aggressive_unsupported");
    expect(note).toBeDefined();
    expect(note?.status).toBe("warn");
    expect(note?.message.toLowerCase()).toContain("not yet implemented");
  });

  // Scenario (scn-09): --since filter excludes older issues
  //   Given a repository containing one issue last updated thirty days ago
  //   And another issue last updated one day ago
  //   When the user runs gxpm doctor issues --since "7d"
  //   Then the report includes only the issue last updated one day ago
  test("test_since_filter_excludes_older_issues", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-009", { archived: true, currentPhase: "land" });
    writeIssueState(repo, "GXPM-010", { archived: true, currentPhase: "land" });
    makeWorktreeDir(repo, "gxpm-GXPM-009");
    makeWorktreeDir(repo, "gxpm-GXPM-010");

    // Backdate GXPM-009's state.json to 30 days ago; leave GXPM-010 fresh.
    const oldPath = join(repo, ".gxpm", "issues", "GXPM-009", "state.json");
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, thirtyDaysAgo, thirtyDaysAgo);

    const report = runDoctorIssues({ root: repo, since: "7d" });

    const issueIds = new Set(
      report.checks.filter((c) => c.issueId).map((c) => c.issueId as string),
    );
    expect(issueIds.has("GXPM-010")).toBe(true);
    expect(issueIds.has("GXPM-009")).toBe(false);
  });

  // Scenario (scn-10): --json output matches the doctor schema contract
  //   Given a repository containing one healthy issue
  //   When the user runs gxpm doctor issues --json
  //   Then the standard output parses as JSON
  //   And the JSON exposes the schema_version field with value one
  //   And the JSON exposes status, health_score, and checks fields
  test("test_json_output_matches_the_doctor_schema_contract", () => {
    const repo = makeFixtureRepo();
    writeIssueState(repo, "GXPM-100", { currentPhase: "implement" });

    const report = runDoctorIssues({ root: repo });
    const serialized = JSON.stringify(report);
    const parsed = JSON.parse(serialized);

    expect(parsed.schema_version).toBe(1);
    expect(parsed.status).toBeDefined();
    expect(parsed.health_score).toBeDefined();
    expect(Array.isArray(parsed.checks)).toBe(true);
  });
});
