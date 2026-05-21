// Feature: agent self-recovery commands (doctor identity + phase handoff)
//
// Scenario (scn-06): gxpm doctor identity 在 worktree 内输出完整身份卡
//   Given 当前工作目录是 GXPM-187 的 worktree
//   When  执行 gxpm doctor identity
//   Then  stdout 包含 ownerIssueId "GXPM-187"
//   And   stdout 包含 currentPhase
//   And   stdout 包含 requiredSkill
//   And   stdout 包含最近 3 条 commit subject
//   And   退出码为 0
//
// Scenario (scn-07): gxpm issue handoff --to-next-phase 产出结构化 phase-handoff artifact
//   Given GXPM-187 处于 plan phase
//   When  执行 gxpm issue handoff GXPM-187 --to-next-phase
//   Then  文件 .gxpm/issues/GXPM-187/artifacts/phase-handoff.json 存在
//   And   该 artifact 包含 completedAcceptance / nextPhaseMustRead / openBlockers 三个字段
//   And   events.jsonl 末尾有 phase.handoff.dumped 事件

import { test } from "bun:test";

test("scn-06 doctor identity prints owner issue id phase skill and recent commits", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});

test("scn-07 issue handoff to-next-phase emits phase-handoff artifact and event", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});
