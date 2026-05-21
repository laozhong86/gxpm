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

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorktreeIdentity } from "../core/worktree-owner";

function setupRepo(): { repoRoot: string; worktree: string; issueId: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "gxpm-187-id-repo-"));
  const worktree = mkdtempSync(join(tmpdir(), "gxpm-187-id-wt-"));
  const issueId = "GXPM-T1";
  mkdirSync(join(repoRoot, ".gxpm", "issues", issueId), { recursive: true });
  return { repoRoot, worktree, issueId };
}

function readEventsLines(repoRoot: string, issueId: string): unknown[] {
  const path = join(repoRoot, ".gxpm", "issues", issueId, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test("scn-01 ensureWorktreeIdentity writes identity files and emits worktree.identity.written", () => {
  const { repoRoot, worktree, issueId } = setupRepo();

  const result = ensureWorktreeIdentity({
    repoRoot,
    workspacePath: worktree,
    issueId,
    currentPhase: "dispatch",
    branchName: "gxpm-GXPM-T1",
  });

  expect(result.created).toBe(true);
  expect(existsSync(join(worktree, ".gxpm-worktree-owner.json"))).toBe(true);
  expect(existsSync(join(worktree, "ISSUE_CONTEXT.md"))).toBe(true);

  const events = readEventsLines(repoRoot, issueId);
  const identityEvents = events.filter(
    (e): e is { type: string; issueId: string; payload: { worktreePath: string } } =>
      typeof e === "object" && e !== null && (e as { type?: unknown }).type === "worktree.identity.written",
  );
  expect(identityEvents.length).toBe(1);
  expect(identityEvents[0].issueId).toBe(issueId);
  expect(identityEvents[0].payload.worktreePath).toBe(worktree);
});

test("scn-02 second ensureWorktreeIdentity preserves createdAt and refreshes updatedAt", async () => {
  const { repoRoot, worktree, issueId } = setupRepo();

  const first = ensureWorktreeIdentity({
    repoRoot,
    workspacePath: worktree,
    issueId,
    currentPhase: "dispatch",
    branchName: "gxpm-GXPM-T1",
  });

  await new Promise((r) => setTimeout(r, 5));

  const second = ensureWorktreeIdentity({
    repoRoot,
    workspacePath: worktree,
    issueId,
    currentPhase: "implement",
    branchName: "gxpm-GXPM-T1",
  });

  expect(second.created).toBe(false);
  const marker = JSON.parse(readFileSync(join(worktree, ".gxpm-worktree-owner.json"), "utf8"));
  expect(marker.createdAt).toBe(first.createdAt);
  expect(marker.updatedAt).not.toBe(first.createdAt);
  expect(new Date(marker.updatedAt).getTime()).toBeGreaterThan(new Date(first.createdAt).getTime());
});

test("scn-03 ensureWorktreeIdentity rejects ownerIssueId mismatch without overwriting", () => {
  const { repoRoot, worktree } = setupRepo();
  mkdirSync(join(repoRoot, ".gxpm", "issues", "GXPM-T2"), { recursive: true });

  // Pre-seed worktree with marker for GXPM-T1
  writeFileSync(
    join(worktree, ".gxpm-worktree-owner.json"),
    JSON.stringify({
      ownerIssueId: "GXPM-T1",
      linkedIssues: [],
      createdAt: "2026-05-21T00:00:00.000Z",
      branchName: "gxpm-GXPM-T1",
      workspacePath: worktree,
    }),
  );

  expect(() =>
    ensureWorktreeIdentity({
      repoRoot,
      workspacePath: worktree,
      issueId: "GXPM-T2",
      currentPhase: "dispatch",
      branchName: "gxpm-GXPM-T2",
    }),
  ).toThrow(/owner issue id mismatch.*GXPM-T1.*GXPM-T2/);

  const marker = JSON.parse(readFileSync(join(worktree, ".gxpm-worktree-owner.json"), "utf8"));
  expect(marker.ownerIssueId).toBe("GXPM-T1");
});
