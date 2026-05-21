import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { writeArtifact } from "../core/artifacts";

function initGitRepo(root: string) {
  Bun.spawnSync({ cmd: ["git", "init", "-b", "main"], cwd: root });
  Bun.spawnSync({ cmd: ["git", "config", "user.email", "t@t"], cwd: root });
  Bun.spawnSync({ cmd: ["git", "config", "user.name", "t"], cwd: root });
  writeFileSync(join(root, ".keep"), "");
  Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
  Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });
}

describe("changedFiles worktree-scoped diff (GXPM-174)", () => {
  test("uses baselineRef from .gxpm-worktree-owner.json when present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cf-base-"));
    initGitRepo(root);
    Bun.spawnSync({ cmd: ["git", "branch", "baseline-tag"], cwd: root });

    // commit something on main
    writeFileSync(join(root, "a.txt"), "a");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "add a"], cwd: root });

    writeFileSync(
      join(root, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-CF-1",
        workspacePath: root,
        baselineRef: "baseline-tag",
      }),
    );

    createIssueState({ root, issueId: "GXPM-CF-1" });

    // local-verify with changedFiles claiming a.txt — should be in diff vs baseline-tag
    const result = writeArtifact({
      root,
      issueId: "GXPM-CF-1",
      type: "local-verify",
      payload: {
        status: "ready",
        commands: ["bun test"],
        results: ["pass"],
        changedFiles: ["a.txt"],
      },
    });
    expect(result.type).toBe("local-verify");
  });

  test("falls back to HEAD diff when baselineRef and origin/main are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cf-fallback-"));
    initGitRepo(root);
    createIssueState({ root, issueId: "GXPM-CF-2" });

    // unstaged change so 'git diff HEAD' surfaces b.txt
    writeFileSync(join(root, "b.txt"), "b");

    const result = writeArtifact({
      root,
      issueId: "GXPM-CF-2",
      type: "local-verify",
      payload: {
        status: "ready",
        commands: ["bun test"],
        results: ["pass"],
        changedFiles: ["b.txt"],
      },
    });
    expect(result.type).toBe("local-verify");
  });

  test("stale baselineRef falls back to HEAD diff without raising", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cf-stale-"));
    initGitRepo(root);
    writeFileSync(
      join(root, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-CF-3",
        workspacePath: root,
        baselineRef: "nonexistent-ref-xyz",
      }),
    );

    createIssueState({ root, issueId: "GXPM-CF-3" });
    writeFileSync(join(root, "c.txt"), "c");

    const result = writeArtifact({
      root,
      issueId: "GXPM-CF-3",
      type: "local-verify",
      payload: {
        status: "ready",
        commands: ["bun test"],
        results: ["pass"],
        changedFiles: ["c.txt"],
      },
    });
    expect(result.type).toBe("local-verify");
  });
});
