// Feature: gxpm worktree identity files
//
// Scenario (scn-01): gxpm 创建 worktree 时强制写入身份文件并发出 worktree.identity.written 事件
//   Given 主仓内执行 gxpm workspace ensure GXPM-187
//   When 命令成功返回
//   Then worktree 根存在 .gxpm-worktree-owner.json
//   And  worktree 根存在 ISSUE_CONTEXT.md
//   And  events.jsonl 末尾有一条 worktree.identity.written 事件，含 issueId 与 worktreePath
//
// Scenario (scn-02): 已存在的身份文件被二次 ensure 时通过 issueId 校验保持一致性
//   Given GXPM-187 的 worktree 已经存在且 .gxpm-worktree-owner.json 的 ownerIssueId 是 "GXPM-187"
//   When  再次执行 gxpm workspace ensure GXPM-187
//   Then  命令成功返回
//   And   身份文件 createdAt 字段不变
//   And   身份文件 updatedAt 字段被刷新
//
// Scenario (scn-03): 当身份文件 ownerIssueId 与命令参数不一致时 ensure 报错而非覆盖
//   Given GXPM-187 的 worktree 路径下有一份 ownerIssueId 为 "GXPM-999" 的身份文件
//   When  在该路径执行 gxpm workspace ensure GXPM-187
//   Then  命令以非零退出码失败
//   And   错误信息指出 issueId 冲突
//   And   既有身份文件未被修改

import { test } from "bun:test";

test("scn-01 worktree ensure writes identity files and emits worktree.identity.written", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});

test("scn-02 second ensure preserves createdAt and refreshes updatedAt", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});

test("scn-03 ensure rejects ownerIssueId mismatch without overwriting", () => {
  // intentionally empty — awaiting user confirmation in specify phase
});
