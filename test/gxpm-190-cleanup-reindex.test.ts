// Feature: gxpm cleanup land fires GitNexus reindex on success
//
// Scenario (scn-01): cleanup land --execute 成功后写入 gitnexus.reindex.triggered 事件
//   Given GXPM-190 worktree 已创建且处于 land phase
//   And   GXPM_GITNEXUS_REINDEX_MODE=mock 让 reindex 桩成功
//   When  执行 gxpm cleanup land GXPM-190 --execute
//   Then  cleanup 成功完成（cleanup.executed 事件存在）
//   And   events.jsonl 末尾出现 gitnexus.reindex.triggered 事件
//
// Scenario (scn-02): reindex 桩抛错时 cleanup 仍以零退出码完成并写 reindex.failed
//   Given GXPM_GITNEXUS_REINDEX_MODE=mock-fail 让 reindex 桩失败
//   When  执行 gxpm cleanup land GXPM-190 --execute
//   Then  cleanup 命令以零退出码返回
//   And   events.jsonl 出现 gitnexus.reindex.failed 事件
//
// Scenario (scn-03): cleanup land 不带 --execute（dry-run）不触发 reindex
//   Given GXPM_GITNEXUS_REINDEX_MODE=mock
//   When  执行 gxpm cleanup land GXPM-190（无 --execute）
//   Then  events.jsonl 不出现 gitnexus.reindex.triggered 也不出现 gitnexus.reindex.failed
//
// Scenario (scn-04): cleanup land --execute 后已删 worktree 从 GitNexus registry 移除（GXPM-201）
//   Given GXPM_GITNEXUS_REINDEX_MODE=mock
//   And   一个临时 HOME 下的 GitNexus registry 包含该 worktree 条目
//   When  执行 gxpm cleanup land <id> --execute
//   Then  cleanup 成功完成
//   And   archive 中 events.jsonl 出现 gitnexus.unregister.triggered 事件（payload.removed=true）
//   And   registry 中不再存在该 worktree 路径条目
//
// Scenario (scn-05): unregister 桩失败时 cleanup land 仍以零退出码完成并写 unregister.failed（GXPM-201）
//   Given GXPM_GITNEXUS_REINDEX_MODE=mock-fail
//   When  执行 gxpm cleanup land <id> --execute
//   Then  cleanup 命令以零退出码返回
//   And   archive 中 events.jsonl 出现 gitnexus.unregister.failed 事件
//   And   不出现 gitnexus.unregister.triggered 事件

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "../core/artifacts";
import { getIssuePaths } from "../core/state";
import { enterPhase, runCliWithEnv } from "./helpers/workflow";

function initGitRepo(dir: string) {
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function addWorktree(repoDir: string, worktreePath: string, branch: string) {
  execSync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: repoDir });
}

function readEvents(eventsPath: string): Array<{ type: string; payload: Record<string, unknown> }> {
  return readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Read events from the archive copy after cleanup land deleted the source dir (GXPM-192). */
function readArchiveEvents(
  repo: string,
  issueId: string,
): Array<{ type: string; payload: Record<string, unknown> }> {
  const archiveRoot = join(repo, ".gxpm", "archive");
  const entries = readdirSync(archiveRoot).filter((n) => n.endsWith(`-${issueId}`));
  if (entries.length !== 1) {
    throw new Error(`expected 1 archive entry for ${issueId}, found ${entries.length}`);
  }
  return readEvents(join(archiveRoot, entries[0], "events.jsonl"));
}

function setupLandedIssue(issueId: string): { repo: string; worktreePath: string; branch: string } {
  const repo = mkdtempSync(join(tmpdir(), `gxpm-190-repo-${issueId}-`));
  initGitRepo(repo);
  const worktreePath = mkdtempSync(join(tmpdir(), `gxpm-190-wt-${issueId}-`));
  const branch = `feature/${issueId}`;
  addWorktree(repo, worktreePath, branch);
  const mergedSha = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();

  enterPhase(repo, issueId, "land");
  writeArtifact({
    root: repo,
    issueId,
    type: "dispatch-handoff",
    payload: {
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "ready",
      stopRule: "",
      targetBranch: "main",
      validation: [],
      worktreePath,
      worktree: worktreePath,
      branch,
      workerTasks: [],
    },
  });
  writeArtifact({
    root: repo,
    issueId,
    type: "pr-check",
    payload: {
      status: "approved",
      pullRequest: { url: `https://github.com/example/repo/pull/${issueId}` },
      reviewFindings: [],
    },
  });
  writeArtifact({
    root: repo,
    issueId,
    type: "land-findings",
    payload: {
      landReady: true,
      mergePlan: "merged",
      status: "landed",
      mergedAt: new Date().toISOString(),
      mergedSha,
    },
  });
  return { repo, worktreePath, branch };
}

describe("GXPM-190 cleanup land triggers GitNexus reindex", () => {
  test("scn-01 cleanup land --execute emits gitnexus.reindex.triggered event", () => {
    const { repo } = setupLandedIssue("GXPM-190-901");

    const result = runCliWithEnv(repo, ["cleanup", "land", "GXPM-190-901", "--execute"], {
      GXPM_GITNEXUS_REINDEX_MODE: "mock",
    });
    expect(result.exitCode).toBe(0);

    // GXPM-192: source dir is deleted; reindex events live in the archive copy now.
    const events = readArchiveEvents(repo, "GXPM-190-901");
    expect(events.some((e) => e.type === "cleanup.executed")).toBe(true);
    const reindexEvents = events.filter((e) => e.type === "gitnexus.reindex.triggered");
    expect(reindexEvents.length).toBe(1);
    expect((reindexEvents[0].payload as { mode?: string }).mode).toBe("mock");
  });

  test("scn-02 cleanup land --execute with failing reindex still exits 0 and emits gitnexus.reindex.failed", () => {
    const { repo } = setupLandedIssue("GXPM-190-902");

    const result = runCliWithEnv(repo, ["cleanup", "land", "GXPM-190-902", "--execute"], {
      GXPM_GITNEXUS_REINDEX_MODE: "mock-fail",
    });
    expect(result.exitCode).toBe(0);

    // GXPM-192: source dir is deleted; reindex events live in the archive copy now.
    const events = readArchiveEvents(repo, "GXPM-190-902");
    const failed = events.filter((e) => e.type === "gitnexus.reindex.failed");
    expect(failed.length).toBe(1);
    expect((failed[0].payload as { errorMessage?: string }).errorMessage).toBeDefined();
    expect(events.some((e) => e.type === "gitnexus.reindex.triggered")).toBe(false);
  });

  test("scn-03 cleanup land dry-run does not emit any reindex event", () => {
    const { repo } = setupLandedIssue("GXPM-903");

    const result = runCliWithEnv(repo, ["cleanup", "land", "GXPM-903"], {
      GXPM_GITNEXUS_REINDEX_MODE: "mock",
    });
    expect(result.exitCode).toBe(0);

    const events = readEvents(getIssuePaths(repo, "GXPM-903").eventsPath);
    expect(events.some((e) => e.type === "gitnexus.reindex.triggered")).toBe(false);
    expect(events.some((e) => e.type === "gitnexus.reindex.failed")).toBe(false);
  });

  // GXPM-201 scenarios — cleanup land unregisters the deleted worktree from
  // the GitNexus registry. We reuse GXPM_GITNEXUS_REINDEX_MODE so the same
  // mock/mock-fail/auto switch governs both reindex and unregister telemetry.
  test("scn-04 cleanup_land_execute_removes_worktree_from_gitnexus_registry", () => {
    const { repo, worktreePath } = setupLandedIssue("GXPM-190-904");
    const tmpHome = mkdtempSync(join(tmpdir(), "gxpm-201-home-scn05-"));
    const registryDir = join(tmpHome, ".gitnexus");
    require("node:fs").mkdirSync(registryDir, { recursive: true });
    const registryPath = join(registryDir, "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify(
        [
          { name: "keep-me", path: repo, indexedAt: "2026-05-23T00:00:00Z" },
          { name: "GXPM-190-904", path: worktreePath, indexedAt: "2026-05-23T00:00:00Z" },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const result = runCliWithEnv(repo, ["cleanup", "land", "GXPM-190-904", "--execute"], {
      GXPM_GITNEXUS_REINDEX_MODE: "auto",
      HOME: tmpHome,
    });
    expect(result.exitCode).toBe(0);

    const events = readArchiveEvents(repo, "GXPM-190-904");
    const unreg = events.filter((e) => e.type === "gitnexus.unregister.triggered");
    expect(unreg.length).toBe(1);
    expect((unreg[0].payload as { removed?: boolean }).removed).toBe(true);
    expect((unreg[0].payload as { path?: string }).path).toBe(worktreePath);

    const after = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ path: string }>;
    expect(after.some((e) => e.path === worktreePath)).toBe(false);
    expect(after.some((e) => e.path === repo)).toBe(true);
  });

  test("scn-05 cleanup_land_unregister_failure_still_exits_zero_and_logs_failed_event", () => {
    const { repo } = setupLandedIssue("GXPM-190-905");

    const result = runCliWithEnv(repo, ["cleanup", "land", "GXPM-190-905", "--execute"], {
      GXPM_GITNEXUS_REINDEX_MODE: "mock-fail",
    });
    expect(result.exitCode).toBe(0);

    const events = readArchiveEvents(repo, "GXPM-190-905");
    const failed = events.filter((e) => e.type === "gitnexus.unregister.failed");
    expect(failed.length).toBe(1);
    expect((failed[0].payload as { errorMessage?: string }).errorMessage).toBeDefined();
    expect(events.some((e) => e.type === "gitnexus.unregister.triggered")).toBe(false);
  });
});
