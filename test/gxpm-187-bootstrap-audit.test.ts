// Feature: Bootstrap protocol baseline audit script
//
// Scenario (scn-09): 审计脚本扫描 events.jsonl 并产出 Bootstrap 基线报告
//   Given .gxpm/issues/ 下至少 5 个已结束 issue
//   When  执行 bun run scripts/audit-bootstrap-protocol.ts --sample 5
//   Then  stdout 输出 JSON 报告，含 skillAckMissingRate / identityReadMissingRate / sampledIssues
//   And   docs/audits/GXPM-187-bootstrap-baseline.md 存在
//   And   该报告 markdown 含 baseline 数值

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeIssueFixture(root: string, issueId: string, events: object[]): void {
  const issueDir = join(root, ".gxpm", "issues", issueId);
  mkdirSync(issueDir, { recursive: true });
  const eventsPath = join(issueDir, "events.jsonl");
  writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

test("scn-09 bootstrap audit script emits JSON report and markdown baseline doc", async () => {
  const root = mkdtempSync(join(tmpdir(), "gxpm-187-audit-"));

  // 5 issues — 3 with full hygiene (skill ack + identity read), 2 missing one each
  makeIssueFixture(root, "GXPM-A1", [
    { type: "skill.load.required", phase: "plan", skill: "gxpm-planning" },
    { type: "skill.load.satisfied", phase: "plan", skill: "gxpm-planning" },
    { type: "issue.context.read", sessionId: "s1" },
  ]);
  makeIssueFixture(root, "GXPM-A2", [
    { type: "skill.load.required", phase: "plan", skill: "gxpm-planning" },
    { type: "skill.load.satisfied", phase: "plan", skill: "gxpm-planning" },
    { type: "worktree.identity.read", sessionId: "s2" },
  ]);
  makeIssueFixture(root, "GXPM-A3", [
    { type: "skill.load.required", phase: "specify", skill: "gxpm-specifier" },
    { type: "skill.load.satisfied", phase: "specify", skill: "gxpm-specifier" },
    { type: "issue.context.read", sessionId: "s3" },
  ]);
  makeIssueFixture(root, "GXPM-A4", [
    { type: "skill.load.required", phase: "plan", skill: "gxpm-planning" },
    // missing satisfied → skillAckMissing
    { type: "issue.context.read", sessionId: "s4" },
  ]);
  makeIssueFixture(root, "GXPM-A5", [
    { type: "skill.load.required", phase: "plan", skill: "gxpm-planning" },
    { type: "skill.load.satisfied", phase: "plan", skill: "gxpm-planning" },
    // no identity-read events → identityReadMissing
  ]);

  const mdOut = join(root, "audit.md");
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      join(__dirname, "..", "scripts", "audit-bootstrap-protocol.ts"),
      "--root",
      root,
      "--sample",
      "5",
      "--out",
      mdOut,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode, `stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0);

  const report = JSON.parse(stdout);
  expect(report).toHaveProperty("skillAckMissingRate");
  expect(report).toHaveProperty("identityReadMissingRate");
  expect(report).toHaveProperty("sampledIssues");
  expect(Array.isArray(report.sampledIssues)).toBe(true);
  expect(report.sampledIssues.length).toBe(5);

  // 1 of 5 skill.load.required lacks satisfied → rate = 0.2
  expect(report.skillAckMissingRate).toBeCloseTo(0.2, 5);
  // 1 of 5 issues has no identity-read events → rate = 0.2
  expect(report.identityReadMissingRate).toBeCloseTo(0.2, 5);

  expect(existsSync(mdOut)).toBe(true);
  const md = readFileSync(mdOut, "utf8");
  expect(md).toContain("skillAckMissingRate");
  expect(md).toContain("identityReadMissingRate");
  // both rates serialize to 0.2 → 20% in the markdown
  expect(md).toMatch(/20(\.0+)?%/);
});
