import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { createIssueState } from "../core/state";
import {
  cleanupIssueWorkspace,
  ensureIssueWorkspace,
  isPathInsideRoot,
  planIssueWorkspace,
  sanitizeWorkspaceKey,
  scratchIssueId,
} from "../core/workspace-runtime";
import { output, runCli } from "./helpers/workflow";

describe("workspace runtime", () => {
  test("plans a deterministic issue workspace under the configured root", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-plan-"));
    createIssueState({ root, issueId: "GXPM-1" });

    const plan = planIssueWorkspace({ root, issueId: "GXPM-1", workspaceRoot: "workspaces" });

    expect(plan.workspaceKey).toBe("GXPM-1");
    expect(plan.workspaceRoot).toBe(join(root, "workspaces"));
    expect(plan.workspacePath).toBe(join(root, "workspaces", "GXPM-1"));
    expect(plan.exists).toBe(false);
  });

  test("ensures, reuses, and cleans up a workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-ensure-"));
    const workspaceRoot = join(root, "workspaces");
    createIssueState({ root, issueId: "GXPM-2" });

    const created = ensureIssueWorkspace({ root, issueId: "GXPM-2", workspaceRoot });
    expect(created.created).toBe(true);
    expect(existsSync(created.workspacePath)).toBe(true);

    const reused = ensureIssueWorkspace({ root, issueId: "GXPM-2", workspaceRoot });
    expect(reused.created).toBe(false);

    const cleaned = cleanupIssueWorkspace({ root, issueId: "GXPM-2", workspaceRoot });
    expect(cleaned.removed).toBe(true);
    expect(existsSync(created.workspacePath)).toBe(false);
  });

  test("sanitizes issue identifiers for workspace keys", () => {
    expect(sanitizeWorkspaceKey("GXPM 2/unsafe")).toBe("GXPM_2_unsafe");
  });

  test("checks workspace containment with Windows separators", () => {
    const root = "C:\\repo\\.gxpm\\local\\workspaces";

    expect(isPathInsideRoot(root, "C:\\repo\\.gxpm\\local\\workspaces\\GXPM-1", win32)).toBe(true);
    expect(isPathInsideRoot(root, "C:\\repo\\.gxpm\\local\\workspaces-other\\GXPM-1", win32)).toBe(false);
    expect(isPathInsideRoot(root, "C:\\repo\\.gxpm\\local\\workspaces\\..\\outside", win32)).toBe(false);
  });

  test("topic mode bypasses readIssueState for scratch worktrees", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-scratch-"));
    const workspaceRoot = join(root, "workspaces");
    const scratchId = scratchIssueId("fix-login-timeout");

    // No createIssueState call — topic mode must work without state.json.
    const plan = planIssueWorkspace({
      root,
      issueId: scratchId,
      workspaceRoot,
      topic: "fix-login-timeout",
    });

    expect(plan.issueId).toBe("scratch-fix-login-timeout");
    expect(plan.workspaceKey).toBe("scratch-fix-login-timeout");
    expect(plan.workspacePath).toBe(join(workspaceRoot, "scratch-fix-login-timeout"));

    const created = ensureIssueWorkspace({
      root,
      issueId: scratchId,
      workspaceRoot,
      topic: "fix-login-timeout",
    });
    expect(created.created).toBe(true);
    expect(existsSync(created.workspacePath)).toBe(true);

    const cleaned = cleanupIssueWorkspace({
      root,
      issueId: scratchId,
      workspaceRoot,
      topic: "fix-login-timeout",
    });
    expect(cleaned.removed).toBe(true);
  });

  test("CLI accepts --topic flag for scratch workspaces", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-cli-topic-"));
    const workspaceRoot = join(root, "workspaces");
    // Note: no `gxpm issue create` call — scratch mode must work without it.

    const plan = runCli(root, [
      "workspace",
      "plan",
      "--topic",
      "fix-login-timeout",
      "--root",
      workspaceRoot,
      "--json",
    ]);
    expect(plan.exitCode).toBe(0);
    expect(JSON.parse(output(plan))).toMatchObject({
      issueId: "scratch-fix-login-timeout",
      workspaceKey: "scratch-fix-login-timeout",
    });

    const ensure = runCli(root, [
      "workspace",
      "ensure",
      "--topic",
      "fix-login-timeout",
      "--root",
      workspaceRoot,
      "--json",
    ]);
    expect(ensure.exitCode).toBe(0);
    expect(JSON.parse(output(ensure))).toMatchObject({
      issueId: "scratch-fix-login-timeout",
      created: true,
    });

    const cleanup = runCli(root, [
      "workspace",
      "cleanup",
      "--topic",
      "fix-login-timeout",
      "--root",
      workspaceRoot,
      "--json",
    ]);
    expect(cleanup.exitCode).toBe(0);
    expect(JSON.parse(output(cleanup))).toMatchObject({ removed: true });
  });

  test("CLI --topic normalises mixed-case / unsafe characters", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-topic-slug-"));
    const workspaceRoot = join(root, "workspaces");

    const ensure = runCli(root, [
      "workspace",
      "plan",
      "--topic",
      "Fix Login Timeout!!",
      "--root",
      workspaceRoot,
      "--json",
    ]);
    expect(ensure.exitCode).toBe(0);
    expect(JSON.parse(output(ensure))).toMatchObject({
      issueId: "scratch-fix-login-timeout",
    });
  });

  test("CLI rejects empty topic and missing issue-id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-no-args-"));

    const missing = runCli(root, ["workspace", "ensure"]);
    expect(missing.exitCode).not.toBe(0);
    expect(output(missing)).toContain("Usage:");
  });

  test("CLI can plan and ensure a workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-workspace-cli-"));
    const workspaceRoot = join(root, "workspaces");
    expect(runCli(root, ["issue", "create", "GXPM-3"]).exitCode).toBe(0);

    const plan = runCli(root, ["workspace", "plan", "GXPM-3", "--root", workspaceRoot]);
    expect(plan.exitCode).toBe(0);
    expect(output(plan)).toContain(`workspacePath: ${join(workspaceRoot, "GXPM-3")}`);
    expect(output(plan)).toContain("exists: false");

    const ensure = runCli(root, ["workspace", "ensure", "GXPM-3", "--root", workspaceRoot, "--json"]);
    expect(ensure.exitCode).toBe(0);
    expect(JSON.parse(output(ensure))).toMatchObject({
      workspacePath: join(workspaceRoot, "GXPM-3"),
      created: true,
    });

    const cleanup = runCli(root, ["workspace", "cleanup", "GXPM-3", "--root", workspaceRoot, "--json"]);
    expect(cleanup.exitCode).toBe(0);
    expect(JSON.parse(output(cleanup))).toMatchObject({
      workspacePath: join(workspaceRoot, "GXPM-3"),
      removed: true,
    });
    expect(existsSync(join(workspaceRoot, "GXPM-3"))).toBe(false);
  });
});
