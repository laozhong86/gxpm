import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processHook, type HookInput } from "../core/hook-engine";

// Feature: PostToolUse 在 phase 切换命令后注入下一阶段 requiredSkill 提示
//
// As a gxpm agent operating inside a worktree
// I want PostToolUse hook to remind me of the next phase's requiredSkill right after
//   I run `gxpm issue transition` or `gxpm issue handoff --to-next-phase` successfully
// So that I cannot drift into writing artifacts/code without first invoking the
//   skill the phase gate registry mandates.

function baseInput(overrides: Partial<HookInput>): HookInput {
  return {
    session_id: "test-session",
    cwd: "/tmp",
    hook_event_name: "PostToolUse",
    ...overrides,
  };
}

function createInitializedGxpmProject(cwd: string) {
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }
  writeFileSync(
    join(cwd, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "optional", default: "ask" } }),
  );
}

function seedIssueState(cwd: string, issueId: string, phase: string) {
  const issueDir = join(cwd, ".gxpm", "issues", issueId);
  mkdirSync(issueDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(issueDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      issueType: "feature",
      title: "test",
      description: "",
      createdAt: now,
      updatedAt: now,
      currentPhase: phase,
      stateRoot: join(".gxpm", "issues", issueId),
      artifactRoot: join(".gxpm", "issues", issueId, "artifacts"),
      phaseHistory: [{ phase, enteredAt: now, fromPhase: null }],
    }),
  );
}

describe("GXPM-204 · PostToolUse phase-transition reminder", () => {
  // Scenario (scn-01): transition 成功 → reminder 含 phase + requiredSkill 名
  test("test_transition_success_injects_required_skill_reminder", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-204-scn01-"));
    createInitializedGxpmProject(cwd);
    seedIssueState(cwd, "GXPM-999", "plan"); // already transitioned to plan

    const result = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "gxpm issue transition GXPM-999 plan" },
        tool_response: { exit_code: 0 },
      }),
    );

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("plan");
    // plan phase 在 PHASE_GATE_RULES 中的 requiredSkill 是 gxpm-planning
    expect(result.additionalContext).toContain("gxpm-planning");
  });

  // Scenario (scn-02): 命令不匹配 phase-transition 模式 → 行为不变
  test("test_unrelated_command_skips_injection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-204-scn02-"));
    createInitializedGxpmProject(cwd);

    const result = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
        tool_response: { exit_code: 0 },
      }),
    );

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
  });

  // Scenario (scn-03): transition 命令失败 → 不注入
  test("test_transition_failure_skips_injection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-204-scn03-"));
    createInitializedGxpmProject(cwd);
    seedIssueState(cwd, "GXPM-999", "triage");

    const result = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "gxpm issue transition GXPM-999 bad" },
        tool_response: { exit_code: 2 },
      }),
    );

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
  });

  // Scenario (scn-05): transition 命令缺少 phase token（或包含在 echo / 日志中）→ 不注入
  // CodeRabbit round 2 minor: regex must not match `echo "gxpm issue transition GXPM-x"`
  // or `gxpm issue transition GXPM-x` without a real phase token following.
  test("test_transition_without_phase_token_skips_injection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-204-scn05-"));
    createInitializedGxpmProject(cwd);
    seedIssueState(cwd, "GXPM-999", "triage");

    const echoResult = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: 'echo "gxpm issue transition GXPM-999"' },
        tool_response: { exit_code: 0 },
      }),
    );
    expect(echoResult.additionalContext).toBeUndefined();

    const bareResult = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "gxpm issue transition GXPM-999" },
        tool_response: { exit_code: 0 },
      }),
    );
    expect(bareResult.additionalContext).toBeUndefined();
  });

  // Scenario (scn-04): handoff --to-next-phase 不改 state.currentPhase，但 reminder 必须指向下一个 phase
  // 当 state 仍是 implement（handoff 不写 state），reminder 应说"已进入 local-verify"+gxpm-verify。
  test("test_handoff_to_next_phase_uses_next_phase_skill", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-204-scn04-"));
    createInitializedGxpmProject(cwd);
    seedIssueState(cwd, "GXPM-999", "implement"); // implement → local-verify per phase-gates

    const result = await processHook(
      "codex",
      "PostToolUse",
      baseInput({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "gxpm issue handoff GXPM-999 --to-next-phase" },
        tool_response: { exit_code: 0 },
      }),
    );

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("local-verify");
    expect(result.additionalContext).toContain("gxpm-verify");
    // implementer phase's own skill should NOT be mentioned (we moved on)
    expect(result.additionalContext).not.toContain("gxpm-tdd");
  });
});
