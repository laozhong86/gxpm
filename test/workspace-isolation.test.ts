import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { ensureIssueWorkspaceWithResolver } from "../core/workspace-runtime";
import { writeArtifact } from "../core/artifacts";

let originalAutoSync: string | undefined;

beforeEach(() => {
  originalAutoSync = process.env.GXPM_AUTO_SYNC;
  process.env.GXPM_AUTO_SYNC = "false";
});

afterEach(() => {
  if (originalAutoSync === undefined) {
    delete process.env.GXPM_AUTO_SYNC;
  } else {
    process.env.GXPM_AUTO_SYNC = originalAutoSync;
  }
});

describe("ensureIssueWorkspaceWithResolver", () => {
  test("falls back to plain directory when not in a git repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiso-plain-"));
    createIssueState({ root, issueId: "GXPM-50" });

    const result = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-50" });
    expect(result.resolution?.status).toBe("none");
    expect(result.exists).toBe(true);
    expect(result.created).toBe(true);
    expect(existsSync(result.workspacePath)).toBe(true);
  });

  test("reuses existing env via workflow identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiso-reuse-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const workspacePath = mkdtempSync(join(tmpdir(), "gxpm-wiso-existing-"));
    createIssueState({ root, issueId: "GXPM-51" });
    writeArtifact({
      root,
      issueId: "GXPM-51",
      type: "dispatch-handoff",
      payload: { worktree: workspacePath, branch: "gxpm-51-feat", workflowType: "feature", workflowId: "shared-1" },
    });
    createIssueState({ root, issueId: "GXPM-52" });

    const result = await ensureIssueWorkspaceWithResolver({
      root,
      issueId: "GXPM-52",
      hints: { workflowType: "feature", workflowId: "shared-1" },
    });
    expect(result.resolution?.status).toBe("resolved");
    expect(result.method?.type).toBe("workflow_reuse");
    expect(result.workspacePath).toBe(workspacePath);
  });

  test("creates new worktree in a git repo when nothing exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiso-create-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    createIssueState({ root, issueId: "GXPM-52" });

    const result = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-52" });
    expect(result.resolution?.status).toBe("resolved");
    expect(result.method?.type).toBe("created");
    expect(result.exists).toBe(true);
    expectSharedGxpmLink(root, result.workspacePath);
  });

  test("repairs missing shared .gxpm symlink when reusing an existing branch worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiso-repair-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    createIssueState({ root, issueId: "GXPM-53" });

    const first = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-53" });
    rmSync(join(first.workspacePath, ".gxpm"));

    const second = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-53" });

    expect(second.resolution?.status).toBe("resolved");
    expect(second.warnings).toContain("Reused existing worktree for branch.");
    expectSharedGxpmLink(root, second.workspacePath);
  });

  test("does not overwrite a real worktree .gxpm directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiso-protect-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    createIssueState({ root, issueId: "GXPM-54" });

    const first = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-54" });
    rmSync(join(first.workspacePath, ".gxpm"));
    mkdirSync(join(first.workspacePath, ".gxpm"));

    const second = await ensureIssueWorkspaceWithResolver({ root, issueId: "GXPM-54" });

    expect(second.warnings?.some((warning) => warning.includes("not a symlink"))).toBe(true);
    expect(lstatSync(join(second.workspacePath, ".gxpm")).isDirectory()).toBe(true);
    expect(lstatSync(join(second.workspacePath, ".gxpm")).isSymbolicLink()).toBe(false);
  });
});

function expectSharedGxpmLink(root: string, workspacePath: string) {
  const linkPath = join(workspacePath, ".gxpm");
  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(realpathSync(linkPath)).toBe(realpathSync(join(root, ".gxpm")));
}
