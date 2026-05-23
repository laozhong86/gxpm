import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processHook, type HookInput } from "../core/hook-engine";
import { startAutopilotGrant } from "../core/autopilot";

// Feature: Autopilot Stop hook 巡查 skill↔phase 一致性
//
// As an agent operating under an active autopilot grant
// I want Stop hook to block when the current phase's requiredSkill has not
//   been acknowledged via `gxpm skill ack` since the latest skill.load.required
// So that the autopilot does not silently skip the gxpm-* skill that the
//   phase gate registry mandates for the current phase.

function baseInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "test-session",
    cwd: "/tmp",
    hook_event_name: "Stop",
    ...overrides,
  };
}

function initGxpmProject(cwd: string) {
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }
  writeFileSync(
    join(cwd, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "optional", default: "ask" } }),
  );
  // baseline git so worktree-owner readers don't trip
  execSync("git init", { cwd, stdio: "ignore" });
  execSync("git config user.email t@t.com", { cwd, stdio: "ignore" });
  execSync("git config user.name t", { cwd, stdio: "ignore" });
}

function seedIssue(cwd: string, issueId: string, phase: string) {
  const issueDir = join(cwd, ".gxpm", "issues", issueId);
  mkdirSync(issueDir, { recursive: true });
  mkdirSync(join(issueDir, "artifacts"), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(issueDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      issueType: "feature",
      title: "t",
      currentPhase: phase,
      createdAt: now,
      updatedAt: now,
      stateRoot: join(".gxpm", "issues", issueId),
      artifactRoot: join(".gxpm", "issues", issueId, "artifacts"),
      phaseHistory: [{ phase, enteredAt: now, fromPhase: null }],
    }),
  );
  // writeArtifact requires an existing artifact index even when seeding from scratch
  writeFileSync(
    join(issueDir, "artifacts", "index.json"),
    JSON.stringify({ schemaVersion: 1, issueId, artifacts: [] }),
  );
  return issueDir;
}

function appendEvent(issueDir: string, event: Record<string, unknown>) {
  appendFileSync(join(issueDir, "events.jsonl"), JSON.stringify(event) + "\n");
}

function emitSkillRequired(issueDir: string, issueId: string, phase: string, skill: string) {
  appendEvent(issueDir, {
    schemaVersion: 1,
    type: "skill.load.required",
    issueId,
    timestamp: new Date().toISOString(),
    sessionId: "test-session",
    payload: { phase, skill, transitionId: `${issueId}-${phase}-test` },
  });
}

function emitSkillSatisfied(issueDir: string, issueId: string, phase: string, skill: string) {
  appendEvent(issueDir, {
    schemaVersion: 1,
    type: "skill.load.satisfied",
    issueId,
    timestamp: new Date().toISOString(),
    sessionId: "test-session",
    payload: { phase, skill },
  });
}

function writeWorktreeOwner(cwd: string, issueId: string) {
  // Worktree owner marker scopes the Stop policing to this issue.
  writeFileSync(
    join(cwd, ".gxpm-worktree-owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      ownerIssueId: issueId,
      linkedIssues: [issueId],
      createdAt: new Date().toISOString(),
    }),
  );
}

describe("GXPM-207 · Autopilot Stop policing skill↔phase consistency", () => {
  // Scenario (scn-01): active grant + currentPhase 需 skill 但未 ack → Stop block
  test("test_unacked_required_skill_blocks_stop", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-207-scn01-"));
    initGxpmProject(cwd);
    const issueDir = seedIssue(cwd, "GXPM-999", "triage");
    writeWorktreeOwner(cwd, "GXPM-999");
    emitSkillRequired(issueDir, "GXPM-999", "triage", "gxpm-triage");
    startAutopilotGrant({
      root: cwd,
      issueId: "GXPM-999",
      profile: "full-delivery",
      sessionId: "test-session",
    });

    const result = await processHook(
      "codex",
      "Stop",
      baseInput({ cwd, session_id: "test-session" }),
    );

    expect(result.action).toBe("block");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("gxpm-triage");
    expect(result.reason).toContain("gxpm skill ack");
  });

  // Scenario (scn-02): active grant + 已 ack → 本 gate 不 block；既有 GXPM-191
  // continuation 仍可能 block（提示"继续推进"），但 reason 不含 skill-ack 文本。
  test("test_acked_required_skill_does_not_trigger_policing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-207-scn02-"));
    initGxpmProject(cwd);
    const issueDir = seedIssue(cwd, "GXPM-998", "plan");
    writeWorktreeOwner(cwd, "GXPM-998");
    emitSkillRequired(issueDir, "GXPM-998", "plan", "gxpm-planning");
    emitSkillSatisfied(issueDir, "GXPM-998", "plan", "gxpm-planning");
    startAutopilotGrant({
      root: cwd,
      issueId: "GXPM-998",
      profile: "full-delivery",
      sessionId: "test-session",
    });

    const result = await processHook(
      "codex",
      "Stop",
      baseInput({ cwd, session_id: "test-session" }),
    );

    // GXPM-191 continuation still blocks Stop on active grants — that is by
    // design and outside this gate's scope. We only assert the skill-ack
    // reminder is NOT present (i.e. our policing did not fire).
    expect(result.reason ?? "").not.toContain("gxpm skill ack");
  });

  // Scenario (scn-03): 无 active grant → Stop allow（既有行为保持）
  test("test_no_grant_skips_policing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-207-scn03-"));
    initGxpmProject(cwd);
    const issueDir = seedIssue(cwd, "GXPM-997", "triage");
    writeWorktreeOwner(cwd, "GXPM-997");
    emitSkillRequired(issueDir, "GXPM-997", "triage", "gxpm-triage");
    // no startAutopilotGrant call

    const result = await processHook(
      "codex",
      "Stop",
      baseInput({ cwd, session_id: "test-session" }),
    );

    expect(result.action).toBe("allow");
  });

  // Scenario (scn-05): events.jsonl 不存在时 → fail-open（gate 不 block）
  // Codex P1 + CodeRabbit Major: 缺失/不可读 events 应视为"无 required = 已 satisfy"，
  // 否则新 worktree / 瞬时 FS 错误下会误 block。
  test("test_missing_events_log_fails_open", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-207-scn05-"));
    initGxpmProject(cwd);
    seedIssue(cwd, "GXPM-995", "triage");
    writeWorktreeOwner(cwd, "GXPM-995");
    // 不写任何 events.jsonl（注意 emitSkillRequired 故意不调用）
    startAutopilotGrant({
      root: cwd,
      issueId: "GXPM-995",
      profile: "full-delivery",
      sessionId: "test-session",
    });

    const result = await processHook(
      "codex",
      "Stop",
      baseInput({ cwd, session_id: "test-session" }),
    );

    // 本 gate 不应 fire；GXPM-191 continuation 可能仍 block，但 reason 不含 skill-ack 文本
    expect(result.reason ?? "").not.toContain("gxpm skill ack");
  });

  // Scenario (scn-04): phase requiredSkill=null（如 dispatch / ship）→ 本 gate 不 block
  test("test_null_required_skill_skips_policing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-207-scn04-"));
    initGxpmProject(cwd);
    seedIssue(cwd, "GXPM-996", "dispatch");
    writeWorktreeOwner(cwd, "GXPM-996");
    // dispatch phase has requiredSkill=null, so no skill.load.required emitted at all
    startAutopilotGrant({
      root: cwd,
      issueId: "GXPM-996",
      profile: "full-delivery",
      sessionId: "test-session",
    });

    const result = await processHook(
      "codex",
      "Stop",
      baseInput({ cwd, session_id: "test-session" }),
    );

    // Same shape as scn-02: GXPM-191 continuation may still block, but our
    // skill-ack reminder must not appear.
    expect(result.reason ?? "").not.toContain("gxpm skill ack");
  });
});
