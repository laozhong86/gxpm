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
