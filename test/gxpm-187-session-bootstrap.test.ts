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

import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWorktreeIdentitySummary } from "../core/hook-engine";

function setupWorktreeMarker(opts: {
  ownerIssueId: string;
  currentPhase: string;
}): string {
  const worktree = mkdtempSync(join(tmpdir(), "gxpm-187-bootstrap-"));
  writeFileSync(
    join(worktree, ".gxpm-worktree-owner.json"),
    JSON.stringify({
      ownerIssueId: opts.ownerIssueId,
      linkedIssues: [opts.ownerIssueId],
      createdAt: "2026-05-21T00:00:00.000Z",
      currentPhase: opts.currentPhase,
      branchName: `gxpm-${opts.ownerIssueId}`,
      workspacePath: worktree,
    }),
  );
  return worktree;
}

test("scn-04 SessionStart hook injects ownerIssueId phase skill and recent commits", () => {
  const worktree = setupWorktreeMarker({ ownerIssueId: "GXPM-187", currentPhase: "specify" });
  const commits = [
    { sha: "abc1234567", subject: "chore(release): 0.2.2" },
    { sha: "def4567890", subject: "fix(GXPM-185): bare gxpm invocation routes to help" },
    { sha: "0123456789", subject: "fix(GXPM-184): ship skills-lock.json in npm tarball" },
  ];

  const summary = formatWorktreeIdentitySummary({
    cwd: worktree,
    requiredSkill: "/gxpm-specifier",
    recentCommits: commits,
  });

  expect(summary).not.toBeNull();
  expect(summary!).toContain("GXPM-187");
  expect(summary!).toContain("specify");
  expect(summary!).toContain("/gxpm-specifier");
  for (const c of commits) {
    expect(summary!).toContain(c.subject);
  }
});

test("scn-05 SessionStart hook truncates to 2048 bytes preserving priority fields", () => {
  const worktree = setupWorktreeMarker({ ownerIssueId: "GXPM-187", currentPhase: "specify" });
  // 50 commits, each subject ≥ 200 chars → total raw body > 10KB
  const commits = Array.from({ length: 50 }, (_, i) => ({
    sha: `commit${String(i).padStart(7, "0")}`,
    subject: `feat(GXPM-187): very long commit subject filler #${i} ${"x".repeat(200)}`,
  }));

  const summary = formatWorktreeIdentitySummary({
    cwd: worktree,
    requiredSkill: "/gxpm-specifier",
    recentCommits: commits,
  });

  expect(summary).not.toBeNull();
  expect(Buffer.byteLength(summary!, "utf8")).toBeLessThanOrEqual(2048);
  expect(summary!).toContain("GXPM-187");
  expect(summary!).toContain("specify");
  expect(summary!).toContain("/gxpm-specifier");
  expect(summary!).toContain("… (truncated)");
});
