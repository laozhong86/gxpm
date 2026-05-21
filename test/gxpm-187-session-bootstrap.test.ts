// Feature: Claude Code SessionStart hook injects worktree identity summary
//
// Scenario (scn-04): SessionStart hook 在 worktree 内注入完整身份摘要
//   Given 当前工作目录是 GXPM-187 的 worktree
//   When  Claude Code SessionStart hook 被触发
//   Then  输出包含 ownerIssueId "GXPM-187"
//   And   输出包含 currentPhase
//   And   输出包含 requiredSkill
//   And   输出包含最近 3 条 commit subject
//
// Scenario (scn-05): SessionStart hook 输出在身份摘要超过 2048 字节时被截断且保留高优先级字段
//   Given GXPM-187 worktree 含 50 条很长的 commit
//   When  Claude Code SessionStart hook 在该 worktree 内被触发
//   Then  输出总长度不超过 2048 字节
//   And   输出仍包含 ownerIssueId、currentPhase、requiredSkill
//   And   输出末尾含 "…" 截断提示

import { test } from "bun:test";

test("scn-04 SessionStart hook injects ownerIssueId phase skill and recent commits", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});

test("scn-05 SessionStart hook truncates to 2048 bytes preserving priority fields", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});
