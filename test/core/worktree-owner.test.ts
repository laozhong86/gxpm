import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readWorktreeOwner,
  writeWorktreeOwnerMarker,
  writeIssueContextMd,
  removeIssueContextMd,
} from "../../core/worktree-owner";

describe("worktree-owner", () => {
  test("readWorktreeOwner returns null when file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-wto-missing-"));
    expect(readWorktreeOwner(dir)).toBeNull();
  });

  test("readWorktreeOwner parses v1 marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-wto-v1-"));
    writeFileSync(
      join(dir, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-1",
        linkedIssues: ["GXPM-1"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }) + "\n",
    );
    const owner = readWorktreeOwner(dir);
    expect(owner).not.toBeNull();
    expect(owner!.ownerIssueId).toBe("GXPM-1");
    expect(owner!.linkedIssues).toEqual(["GXPM-1"]);
    expect(owner!.currentPhase).toBeUndefined();
  });

  test("readWorktreeOwner parses v2 marker with extra fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-wto-v2-"));
    writeWorktreeOwnerMarker(dir, {
      ownerIssueId: "GXPM-2",
      linkedIssues: ["GXPM-2", "GXPM-3"],
      currentPhase: "implement",
      title: "Test issue",
      branchName: "gxpm-GXPM-2",
      workspacePath: dir,
    });
    const owner = readWorktreeOwner(dir);
    expect(owner).not.toBeNull();
    expect(owner!.ownerIssueId).toBe("GXPM-2");
    expect(owner!.currentPhase).toBe("implement");
    expect(owner!.title).toBe("Test issue");
    expect(owner!.branchName).toBe("gxpm-GXPM-2");
    expect(owner!.workspacePath).toBe(dir);
    expect(owner!.updatedAt).toBeTruthy();
  });

  test("writeIssueContextMd generates readable markdown", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-ctx-md-"));
    writeIssueContextMd(dir, {
      issueId: "GXPM-5",
      currentPhase: "specify",
      title: "Feature X",
      nextPhase: "implement",
      branchName: "gxpm-GXPM-5",
      workspacePath: dir,
      updatedAt: "2026-05-19T12:00:00.000Z",
    });
    const md = readFileSync(join(dir, "ISSUE_CONTEXT.md"), "utf8");
    expect(md).toContain("# ISSUE_CONTEXT — GXPM-5");
    expect(md).toContain("GXPM-5");
    expect(md).toContain("specify");
    expect(md).toContain("Feature X");
    expect(md).toContain("gxpm-GXPM-5");
    expect(md).toContain("gxpm issue context --auto");
    expect(md).toContain("implement");
  });

  test("writeIssueContextMd works without optional fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-ctx-md-min-"));
    writeIssueContextMd(dir, {
      issueId: "GXPM-6",
      currentPhase: "land",
      workspacePath: dir,
      updatedAt: "2026-05-19T12:00:00.000Z",
    });
    const md = readFileSync(join(dir, "ISSUE_CONTEXT.md"), "utf8");
    expect(md).toContain("GXPM-6");
    expect(md).toContain("land");
    expect(md).not.toContain("下一阶段");
  });

  test("removeIssueContextMd marks file as stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "gxpm-ctx-md-stale-"));
    writeIssueContextMd(dir, {
      issueId: "GXPM-7",
      currentPhase: "ship",
      workspacePath: dir,
      updatedAt: "2026-05-19T12:00:00.000Z",
    });
    removeIssueContextMd(dir);
    const md = readFileSync(join(dir, "ISSUE_CONTEXT.md"), "utf8");
    expect(md).toContain("[STALE]");
  });
});

