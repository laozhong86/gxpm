import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { ensureIssueWorkspaceWithResolver } from "../core/workspace-runtime";
import { writeArtifact } from "../core/artifacts";

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
  });
});
