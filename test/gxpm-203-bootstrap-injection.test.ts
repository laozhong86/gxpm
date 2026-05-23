import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processHook, type HookInput } from "../core/hook-engine";

// Feature: SessionStart 注入 gxpm runtime bootstrap
//
// As a gxpm worktree operator
// I want each new session to receive the gxpm runtime bootstrap contract automatically
// So that the agent honors the "MUST invoke requiredSkill before any artifact/code write"
// discipline without relying on manual recall.

function baseInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "test-session",
    cwd: "/tmp",
    hook_event_name: "SessionStart",
    ...overrides,
  };
}

function createInitializedGxpmProject(cwd: string) {
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }
  writeFileSync(
    join(cwd, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "optional", default: "ask" } }),
  );
}

describe("GXPM-203 · SessionStart bootstrap injection", () => {
  // Scenario (scn-01): initialized gxpm 项目启动会话 → bootstrap 注入 additionalContext
  //   Given 当前工作目录是一个 initialized gxpm 项目（含 .gxpm/issues 与 config.json）
  //   And SessionStart hook 已加载
  //   When 一次 SessionStart 事件触发
  //   Then additionalContext 含 "using-gxpm-runtime" 标题
  //   And additionalContext 含 "MUST invoke requiredSkill" 字样
  test("test_bootstrap_injected_in_initialized_gxpm_project", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-203-bootstrap-init-"));
    createInitializedGxpmProject(cwd);

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("using-gxpm-runtime");
    expect(result.additionalContext).toContain("MUST invoke requiredSkill");
  });

  // Scenario (scn-02): 非 initialized 项目启动会话 → bootstrap 不被注入
  //   Given 当前工作目录不是 initialized gxpm 项目（既无 .gxpm 也无 repo-scoped hook 配置）
  //   When 一次 SessionStart 事件触发
  //   Then additionalContext 不含 "using-gxpm-runtime" marker
  //   And additionalContext 不含 "MUST invoke requiredSkill" 字样
  test("test_bootstrap_skipped_in_uninitialized_repo", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-203-bootstrap-skip-"));

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));

    expect(result.action).toBe("allow");
    if (result.additionalContext) {
      expect(result.additionalContext).not.toContain("using-gxpm-runtime");
      expect(result.additionalContext).not.toContain("MUST invoke requiredSkill");
    }
  });

  // Scenario (scn-03): bootstrap 与现有 schema/version 行共存
  //   Given 一个 initialized gxpm 项目，根目录含 core/state.ts 与 VERSION 文件
  //   When 一次 SessionStart 事件触发
  //   Then additionalContext 同时含 schema/version 行（"schema v" 字样）
  //   And additionalContext 也含 bootstrap 标题，并位于 schema/version 行之后
  test("test_bootstrap_coexists_with_schema_version_line", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-203-bootstrap-coexist-"));
    createInitializedGxpmProject(cwd);
    mkdirSync(join(cwd, "core"), { recursive: true });
    writeFileSync(join(cwd, "core", "state.ts"), "export const CURRENT_SCHEMA_VERSION = 42;\n");
    writeFileSync(join(cwd, "VERSION"), "1.2.3\n");

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));

    expect(result.additionalContext).toBeDefined();
    const ctx = result.additionalContext!;
    expect(ctx).toContain("schema v42");
    expect(ctx).toContain("using-gxpm-runtime");
    expect(ctx.indexOf("schema v42")).toBeLessThan(ctx.indexOf("using-gxpm-runtime"));
  });
});
