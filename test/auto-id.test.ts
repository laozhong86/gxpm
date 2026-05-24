import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNextAvailableIssueId, recentLandedIssues } from "../core/issues";
import { createIssueState, readIssueState, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { enterPhase, output, runCli } from "./helpers/workflow";

describe("getNextAvailableIssueId", () => {
  test("returns GXPM-1 in empty repo", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-empty-"));
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-1");
  });

  test("returns next after the highest existing id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-seq-"));
    createIssueState({ root, issueId: "GXPM-1" });
    createIssueState({ root, issueId: "GXPM-3" });
    createIssueState({ root, issueId: "GXPM-7" });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-8");
  });

  test("ignores non-matching dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-mixed-"));
    createIssueState({ root, issueId: "GXPM-2" });
    createIssueState({ root, issueId: "GXG-99" }); // different prefix
    createIssueState({ root, issueId: "GXPM-tracker-019" }); // non-numeric suffix
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-3");
  });

  test("custom prefix supported", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-pfx-"));
    createIssueState({ root, issueId: "GXG-5" });
    createIssueState({ root, issueId: "GXG-7" });
    expect(getNextAvailableIssueId({ root, prefix: "GXG" })).toBe("GXG-8");
  });
});

// ---------------------------------------------------------------------------
// GXPM-194: auto-id allocator must also scan .gxpm/archive/
//
// Feature: gxpm 自动分配 issue ID 时考虑归档目录
//
// As a 正在创建新 gxpm issue 的工程师或代理
// I want auto-id 分配的新 ID 不会重复任何归档过的 issue ID
// So that 新 issue 的 git commit / PR 编号与历史不冲突
//
// Spec: .gxpm/issues/GXPM-194/artifacts/behavior-spec.json
// ---------------------------------------------------------------------------

describe("getNextAvailableIssueId archive-aware (GXPM-194)", () => {
  // Scenario (scn-01): 归档目录含 ID 高于活跃目录时新 ID 跟在归档之后
  //   Given 仓库 .gxpm/archive/ 下有一个名为 2026-05-21-GXPM-190 的归档目录
  //   And 仓库 .gxpm/issues/ 下没有任何 GXPM-N 目录
  //   When 工程师调用 auto-id 分配函数请求下一个可用 ID
  //   Then 返回的 ID 是 GXPM-191
  //   And 返回的 ID 不等于任何归档目录对应的编号
  test("test_archive_only_picks_next_after_archived", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-archive-only-"));
    mkdirSync(join(root, ".gxpm", "archive", "2026-05-21-GXPM-190"), { recursive: true });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-191");
  });

  // Scenario (scn-02): 活跃目录与归档目录都存在时取两者最大编号加一
  //   Given 仓库 .gxpm/archive/ 含 2026-05-21-GXPM-190 归档目录
  //   And 仓库 .gxpm/issues/ 含 GXPM-192 活跃目录
  //   When 工程师调用 auto-id 分配函数请求下一个可用 ID
  //   Then 返回的 ID 是 GXPM-193
  test("test_max_of_active_and_archived_plus_one", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-both-"));
    mkdirSync(join(root, ".gxpm", "archive", "2026-05-21-GXPM-190"), { recursive: true });
    createIssueState({ root, issueId: "GXPM-192" });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-193");
  });

  // Scenario (scn-03): 归档目录名带额外后缀仍能识别编号
  //   Given 仓库 .gxpm/archive/ 含一个名为 2026-05-21-GXPM-190-auto-id-collision-revoked 的归档目录
  //   And 仓库 .gxpm/issues/ 为空
  //   When 工程师调用 auto-id 分配函数请求下一个可用 ID
  //   Then 返回的 ID 是 GXPM-191
  //   And 归档目录的额外后缀不影响编号提取
  test("test_archive_dir_with_suffix_still_recognized", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-archive-suffix-"));
    mkdirSync(
      join(root, ".gxpm", "archive", "2026-05-21-GXPM-190-auto-id-collision-revoked"),
      { recursive: true },
    );
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-191");
  });

  // Scenario (scn-04): 归档目录不存在时仅扫描活跃目录
  //   Given 仓库不存在 .gxpm/archive/ 目录
  //   And 仓库 .gxpm/issues/ 含 GXPM-5 活跃目录
  //   When 工程师调用 auto-id 分配函数请求下一个可用 ID
  //   Then 返回的 ID 是 GXPM-6
  test("test_missing_archive_falls_back_to_issues_only", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-no-archive-"));
    createIssueState({ root, issueId: "GXPM-5" });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-6");
  });

  // Scenario (scn-05): 归档目录与活跃目录含同一编号时仍取最大编号加一
  //   Given 仓库 .gxpm/archive/ 含 2026-05-21-GXPM-100 归档目录
  //   And 仓库 .gxpm/issues/ 也含 GXPM-100 活跃目录（异常但容忍）
  //   When 工程师调用 auto-id 分配函数请求下一个可用 ID
  //   Then 返回的 ID 是 GXPM-101
  //   And 函数不抛出异常
  test("test_duplicate_id_across_archive_and_issues_still_advances", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-dup-"));
    mkdirSync(join(root, ".gxpm", "archive", "2026-05-21-GXPM-100"), { recursive: true });
    createIssueState({ root, issueId: "GXPM-100" });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-101");
  });
});

describe("recentLandedIssues", () => {
  test("returns empty when no landed issues", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-empty-"));
    createIssueState({ root, issueId: "GXPM-1" });
    expect(recentLandedIssues({ root })).toEqual([]);
  });

  test("returns landed issues sorted by updatedAt desc", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-many-"));
    // Walk one to land using helpers
    enterPhase(root, "GXPM-FIRST", "qa");
    writeArtifact({ root, issueId: "GXPM-FIRST", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-FIRST", nextPhase: "land" });

    // Wait a tick to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 5));

    enterPhase(root, "GXPM-SECOND", "qa");
    writeArtifact({ root, issueId: "GXPM-SECOND", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-SECOND", nextPhase: "land" });

    const recent = recentLandedIssues({ root, limit: 5 });
    expect(recent.length).toBe(2);
    expect(recent[0].issueId).toBe("GXPM-SECOND");
    expect(recent[1].issueId).toBe("GXPM-FIRST");
  });

  test("respects limit", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-limit-"));
    for (const id of ["GXPM-A", "GXPM-B", "GXPM-C"]) {
      enterPhase(root, id, "qa");
      writeArtifact({ root, issueId: id, type: "land-findings", payload: {} });
      transitionIssuePhase({ root, issueId: id, nextPhase: "land" });
    }
    expect(recentLandedIssues({ root, limit: 2 }).length).toBe(2);
  });
});

describe("gxpm issue create --auto-id CLI", () => {
  test("picks next available id when --auto-id passed", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-auto-"));
    expect(runCli(root, ["issue", "create", "GXPM-1"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-3"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "create", "--auto-id"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("created GXPM-4");
  });

  test("writes explicit issue type when --type is passed", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-type-"));

    const r = runCli(root, ["issue", "create", "--auto-id", "--type", "meta"]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("created GXPM-1");
    expect(readIssueState({ root, issueId: "GXPM-1" }).issueType).toBe("meta");
  });

  test("rejects mixing a literal issue id with --auto-id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-auto-positional-"));

    const r = runCli(root, ["issue", "create", "GXPM-1", "--auto-id"]);

    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("Usage: gxpm issue create");
  });
});

describe("gxpm issue list --recent CLI", () => {
  test("--recent N shows landed issues regardless of default filter", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-recent-"));
    enterPhase(root, "GXPM-LAND-A", "qa");
    writeArtifact({ root, issueId: "GXPM-LAND-A", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-LAND-A", nextPhase: "land" });

    const r = runCli(root, ["issue", "list", "--recent", "5"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("GXPM-LAND-A");
    expect(output(r)).toContain("land");
  });

  test("--recent rejects type and limit filters", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-recent-filter-"));

    const typeFilter = runCli(root, ["issue", "list", "--recent", "5", "--type", "meta"]);
    const limitFilter = runCli(root, ["issue", "list", "--recent", "5", "--limit", "2"]);

    expect(typeFilter.exitCode).toBe(1);
    expect(limitFilter.exitCode).toBe(1);
    expect(output(typeFilter)).toContain("--recent cannot be combined");
    expect(output(limitFilter)).toContain("--recent cannot be combined");
  });
});
