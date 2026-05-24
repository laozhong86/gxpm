// Feature: identity.read.missing audit telemetry
//
// Scenario (scn-08): artifact write 时缺少 identity-read 事件会被记录为 identity.read.missing 告警
//   Given 当前 session 在 GXPM-187 worktree 内但未触发过 issue.context.read 也未读 ISSUE_CONTEXT.md
//   When  执行 gxpm artifact write GXPM-187 implementation-plan --json '...'
//   Then  artifact 写入成功（默认 warn 模式）
//   And   events.jsonl 出现 identity.read.missing 事件，含 sessionId / phase / cwd

import { test } from "bun:test";

test("scn-08 artifact write without identity read logs identity.read.missing in warn mode", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});
