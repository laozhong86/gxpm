import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli, output } from "./helpers/workflow";
import { createIssueState } from "../core/state";

describe("gxpm issue parent linkage and scope drift", () => {
  test("issue create --parent links child to parent (scn-01)", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-parent-"));
    expect(runCli(root, ["issue", "create", "GXPM-PARENT-1"]).exitCode).toBe(0);
    const child = runCli(root, ["issue", "create", "GXPM-CHILD-1", "--parent", "GXPM-PARENT-1"]);
    expect(child.exitCode).toBe(0);
    expect(output(child)).toContain("parent: GXPM-PARENT-1");

    const status = runCli(root, ["issue", "status", "GXPM-CHILD-1"]);
    expect(status.exitCode).toBe(0);
    expect(output(status)).toContain("GXPM-CHILD-1");
  });

  test("issue list shows parent/child relationship flags (scn-01)", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-parent-list-"));
    expect(runCli(root, ["issue", "create", "GXPM-P-2"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-C-2", "--parent", "GXPM-P-2"]).exitCode).toBe(0);

    const list = runCli(root, ["issue", "list", "--all"]);
    expect(list.exitCode).toBe(0);
    const out = output(list);
    expect(out).toContain("has-parent");
  });

  test("hook UserPromptSubmit warns on scope drift (scn-03)", async () => {
    const { processHook } = await import("../core/hook-engine");
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-drift-"));
    createIssueState({ root: cwd, issueId: "GXPM-OWNER-1" });

    writeFileSync(
      join(cwd, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-OWNER-1",
        linkedIssues: ["GXPM-OWNER-1"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }) + "\n",
    );

    const result = await processHook("codex", "UserPromptSubmit", {
      session_id: "test",
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "继续 GXPM-99",
    });

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeTruthy();
    const ctx = String(result.additionalContext);
    expect(ctx).toContain("SCOPE DRIFT DETECTED");
    expect(ctx).toContain("GXPM-OWNER-1");
    expect(ctx).toContain("GXPM-99");
  });

  test("hook allows prompt for linked issue (scn-03)", async () => {
    const { processHook } = await import("../core/hook-engine");
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-linked-"));
    createIssueState({ root: cwd, issueId: "GXPM-OWNER-2" });
    createIssueState({ root: cwd, issueId: "GXPM-CHILD-2" });

    writeFileSync(
      join(cwd, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-OWNER-2",
        linkedIssues: ["GXPM-OWNER-2", "GXPM-CHILD-2"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }) + "\n",
    );

    const result = await processHook("codex", "UserPromptSubmit", {
      session_id: "test",
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "继续 GXPM-CHILD-2",
    });

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
  });
});
