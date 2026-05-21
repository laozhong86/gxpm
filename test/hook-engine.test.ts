import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  detectHostFromEnv,
  isValidHookHost,
  formatHookOutput,
  processHook,
  type HookInput,
} from "../core/hook-engine";
import { startAutopilotGrant } from "../core/autopilot";
import { createIssueState } from "../core/state";

const repoRoot = resolve(import.meta.dir, "..");

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
  writeFileSync(join(cwd, ".gxpm", "config.json"), JSON.stringify({
    worktree: { enforcement: "optional", default: "ask" },
  }));
}

describe("hook-engine utilities", () => {
  test("isValidHookHost accepts known hosts", () => {
    expect(isValidHookHost("claude")).toBe(true);
    expect(isValidHookHost("codex")).toBe(true);
    expect(isValidHookHost("cursor")).toBe(true);
    expect(isValidHookHost("kimi")).toBe(true);
    expect(isValidHookHost("unknown")).toBe(false);
    expect(isValidHookHost("")).toBe(false);
  });

  test("detectHostFromEnv returns claude when CLAUDE_PROJECT_DIR is set", () => {
    const orig = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = "/some/project";
    expect(detectHostFromEnv()).toBe("claude");
    if (orig === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = orig;
    }
  });

  test("detectHostFromEnv returns null when no env hints present", () => {
    const orig = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(detectHostFromEnv()).toBeNull();
    if (orig !== undefined) process.env.CLAUDE_PROJECT_DIR = orig;
  });
});

describe("formatHookOutput", () => {
  test("Codex SessionStart with additionalContext", () => {
    const out = formatHookOutput("codex", "SessionStart", {
      action: "allow",
      additionalContext: "hello",
      exitCode: 0,
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("hello");
  });

  test("Codex PreToolUse block", () => {
    const out = formatHookOutput("codex", "PreToolUse", {
      action: "block",
      reason: "blocked",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("blocked");
  });

  test("Codex Stop block uses decision:block shape", () => {
    const out = formatHookOutput("codex", "Stop", {
      action: "block",
      reason: "keep going",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toBe("keep going");
  });

  test("Claude SessionStart returns plain text", () => {
    const out = formatHookOutput("claude", "SessionStart", {
      action: "allow",
      additionalContext: "plain text",
      exitCode: 0,
    });
    expect(out).toBe("plain text");
  });

  test("Claude UserPromptSubmit returns JSON additionalContext", () => {
    const out = formatHookOutput("claude", "UserPromptSubmit", {
      action: "allow",
      additionalContext: "ctx",
      exitCode: 0,
    });
    expect(JSON.parse(out).additionalContext).toBe("ctx");
  });

  test("Claude PreToolUse block returns permissionDecision", () => {
    const out = formatHookOutput("claude", "PreToolUse", {
      action: "block",
      reason: "no",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("Kimi block returns permissionDecision JSON", () => {
    const out = formatHookOutput("kimi", "PreToolUse", {
      action: "block",
      reason: "blocked",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("Kimi allow without context returns empty", () => {
    const out = formatHookOutput("kimi", "SessionStart", {
      action: "allow",
      exitCode: 0,
    });
    expect(out).toBe("");
  });

  test("allow without additionalContext returns empty for all hosts", () => {
    for (const host of ["claude", "codex", "kimi", "cursor"] as const) {
      expect(formatHookOutput(host, "SessionStart", { action: "allow", exitCode: 0 })).toBe("");
    }
  });
});

describe("processHook SessionStart", () => {
  test("plain repo without gxpm markers → allow with no output", async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-empty-"));
    const result = await processHook("codex", "SessionStart", baseInput({ cwd: emptyCwd }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(emptyCwd, ".gxpm"))).toBe(false);
  });

  test("repo-scoped gxpm hook without .gxpm → reports uninitialized without writing state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-uninit-"));
    mkdirSync(join(cwd, ".codex"), { recursive: true });
    writeFileSync(join(cwd, ".codex", "hooks.json"), JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "gxpm hook SessionStart --host codex" }] }],
      },
    }));

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toContain("not been initialized");
    expect(result.additionalContext).toContain("gxpm init --target <repo>");
    expect(existsSync(join(cwd, ".gxpm"))).toBe(false);
  });

  test("partial .gxpm state → reports missing initialization markers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-partial-"));
    mkdirSync(join(cwd, ".gxpm", "issues"), { recursive: true });

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toContain("initialization is incomplete");
    expect(result.additionalContext).toContain(".gxpm/local");
    expect(result.additionalContext).toContain("will not write plan state");
  });

  test("git repo with gxpm dirs but missing gxpm git hooks → reports partial initialization", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-missing-hooks-"));
    createInitializedGxpmProject(cwd);
    execSync("git init", { cwd, stdio: "ignore" });

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toContain("initialization is incomplete");
    expect(result.additionalContext).toContain(".githooks/gxpm-pre-commit");
    expect(result.additionalContext).toContain(".githooks/gxpm-post-checkout");
  });

  test("initialized gxpm project → injects schema/version context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-ctx-"));
    createInitializedGxpmProject(cwd);
    mkdirSync(join(cwd, "core"), { recursive: true });
    writeFileSync(join(cwd, "core", "state.ts"), "export const CURRENT_SCHEMA_VERSION = 42;\n");
    writeFileSync(join(cwd, "VERSION"), "1.2.3\n");

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toContain("schema v42, version 1.2.3");
    expect(result.additionalContext).toContain("gxpm issue list");
  });

  test("with optional wiki state → does not inject or auto-update wiki context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-human-wiki-"));
    createInitializedGxpmProject(cwd);
    writeFileSync(join(cwd, ".gxpm", "wiki", "state.json"), JSON.stringify({
      schemaVersion: 1,
      provider: "gxpm",
      status: "idle",
      generatedAt: "2026-05-06T00:00:00.000Z",
    }));

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));

    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("schema v");
    expect(result.additionalContext).not.toContain("wiki");
    expect(readFileSync(join(cwd, ".gxpm", "wiki", "state.json"), "utf8")).toContain("2026-05-06T00:00:00.000Z");
  });

  test("on main branch in canonical checkout → no worktree warning", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-main-"));
    createInitializedGxpmProject(cwd);
    execSync("git init", { cwd, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd, stdio: "ignore" });
    execSync("git config user.name Test", { cwd, stdio: "ignore" });
    execSync("git checkout -b main", { cwd, stdio: "ignore" });
    mkdirSync(join(cwd, ".githooks"), { recursive: true });
    for (const hook of ["gxpm-pre-commit", "gxpm-commit-msg", "gxpm-pre-push", "gxpm-post-merge", "gxpm-post-checkout"]) {
      writeFileSync(join(cwd, ".githooks", hook), "#!/bin/bash\n");
    }

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).not.toContain("WARNING:");
  });

  test("on feature branch in canonical checkout → worktree warning first", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-feat-"));
    createInitializedGxpmProject(cwd);
    execSync("git init", { cwd, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd, stdio: "ignore" });
    execSync("git config user.name Test", { cwd, stdio: "ignore" });
    execSync("git checkout -b gxpm-92-test", { cwd, stdio: "ignore" });
    mkdirSync(join(cwd, ".githooks"), { recursive: true });
    for (const hook of ["gxpm-pre-commit", "gxpm-commit-msg", "gxpm-pre-push", "gxpm-post-merge", "gxpm-post-checkout"]) {
      writeFileSync(join(cwd, ".githooks", hook), "#!/bin/bash\n");
    }

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).toContain("WARNING:");
    expect(result.additionalContext).toContain("gxpm-92-test");
    expect(result.additionalContext).toContain("gxpm workspace ensure");
    // Worktree warning should appear before schema context
    const idxWarning = result.additionalContext!.indexOf("WARNING:");
    const idxSchema = result.additionalContext!.indexOf("schema v");
    expect(idxWarning).toBeLessThan(idxSchema);
  });

  test("on feature branch inside worktree → no worktree warning", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ss-wt-"));
    createInitializedGxpmProject(cwd);
    execSync("git init", { cwd, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd, stdio: "ignore" });
    execSync("git config user.name Test", { cwd, stdio: "ignore" });
    execSync("git checkout -b gxpm-92-test", { cwd, stdio: "ignore" });
    mkdirSync(join(cwd, ".githooks"), { recursive: true });
    for (const hook of ["gxpm-pre-commit", "gxpm-commit-msg", "gxpm-pre-push", "gxpm-post-merge", "gxpm-post-checkout"]) {
      writeFileSync(join(cwd, ".githooks", hook), "#!/bin/bash\n");
    }
    // Simulate worktree by creating a .git file pointing to a worktrees path
    // and creating the git-path structure so rev-parse --git-path HEAD returns a worktrees path
    const gitDir = execSync("git rev-parse --git-dir", { cwd, encoding: "utf8" }).trim();
    const absGitDir = resolve(cwd, gitDir);
    // In a real worktree, --git-path HEAD returns something like .../worktrees/<name>/HEAD
    // We simulate by replacing .git/HEAD with a path containing /worktrees/
    const headPath = join(absGitDir, "HEAD");
    // Create a fake worktrees directory structure
    const worktreeDir = join(absGitDir, "worktrees", "test-wt");
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(join(worktreeDir, "HEAD"), "ref: refs/heads/gxpm-92-test\n");
    // Replace the main HEAD with a file pointing to the worktree HEAD (like git worktree does)
    writeFileSync(headPath, `gitdir: ${worktreeDir}\n`);

    const result = await processHook("codex", "SessionStart", baseInput({ cwd }));
    expect(result.additionalContext).toBeDefined();
    expect(result.additionalContext).not.toContain("WARNING:");
  });
});

describe("processHook UserPromptSubmit", () => {
  test("prompt without issue ref → allow no context", async () => {
    const result = await processHook("codex", "UserPromptSubmit", baseInput({
      hook_event_name: "UserPromptSubmit",
      prompt: "hello world",
    }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
  });

  test("prompt with GXPM-N but no state → allow no context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ups-nostate-"));
    const result = await processHook("codex", "UserPromptSubmit", baseInput({
      hook_event_name: "UserPromptSubmit",
      prompt: "继续 GXPM-99",
      cwd,
    }));
    expect(result.action).toBe("allow");
    expect(result.additionalContext).toBeUndefined();
  });

  test("prompt without issue ref injects active autopilot grant context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ups-autopilot-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });
    startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

    const result = await processHook("codex", "UserPromptSubmit", baseInput({
      hook_event_name: "UserPromptSubmit",
      prompt: "继续",
      cwd,
    }));

    expect(result.action).toBe("allow");
    expect(result.additionalContext).toContain("gxpm autopilot grant active");
    expect(result.additionalContext).toContain("GXPM-1");
    expect(result.additionalContext).toContain("Do not ask for confirmation");
  });
});

describe("processHook Stop", () => {
  test("active autopilot grant blocks stop with continuation instruction", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-autopilot-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });

    const orig = process.env.CODEX_COMPANION_SESSION_ID;
    try {
      process.env.CODEX_COMPANION_SESSION_ID = "owner-session";
      startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

      const result = await processHook("codex", "Stop", baseInput({
        hook_event_name: "Stop",
        cwd,
        session_id: "codex:owner-session",
        stop_hook_active: false,
      }));

      expect(result.action).toBe("block");
      expect(result.reason).toContain("Continue the gxpm workflow now");
      expect(result.exitCode).toBe(2);
    } finally {
      if (orig === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
      else process.env.CODEX_COMPANION_SESSION_ID = orig;
    }
  });

  test("already active stop hook fails open", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-active-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });
    startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

    const result = await processHook("codex", "Stop", baseInput({
      hook_event_name: "Stop",
      cwd,
      stop_hook_active: true,
    }));

    expect(result.action).toBe("allow");
  });

  test("unrelated session in same cwd is not hijacked by another session's grant", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-unrelated-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });

    const orig = process.env.CODEX_COMPANION_SESSION_ID;
    try {
      process.env.CODEX_COMPANION_SESSION_ID = "grant-creator";
      startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

      const result = await processHook("codex", "Stop", baseInput({
        hook_event_name: "Stop",
        cwd,
        session_id: "codex:unrelated-session",
        stop_hook_active: false,
      }));

      expect(result.action).toBe("allow");
      expect(result.reason).toBeUndefined();
    } finally {
      if (orig === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
      else process.env.CODEX_COMPANION_SESSION_ID = orig;
    }
  });

  test("session-matched stop is blocked to continue autopilot", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-session-match-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });

    const orig = process.env.CODEX_COMPANION_SESSION_ID;
    try {
      process.env.CODEX_COMPANION_SESSION_ID = "matched-session";
      startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

      const result = await processHook("codex", "Stop", baseInput({
        hook_event_name: "Stop",
        cwd,
        session_id: "codex:matched-session",
        stop_hook_active: false,
      }));

      expect(result.action).toBe("block");
      expect(result.reason).toContain("Continue the gxpm workflow now");
      expect(result.exitCode).toBe(2);
    } finally {
      if (orig === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
      else process.env.CODEX_COMPANION_SESSION_ID = orig;
    }
  });

  test("worktree-owned session is blocked even when grant was opened by another session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-worktree-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });

    const orig = process.env.CODEX_COMPANION_SESSION_ID;
    try {
      process.env.CODEX_COMPANION_SESSION_ID = "previous-session";
      startAutopilotGrant({ root: cwd, issueId: "GXPM-1" });

      writeFileSync(
        join(cwd, ".gxpm-worktree-owner.json"),
        JSON.stringify({
          ownerIssueId: "GXPM-1",
          linkedIssues: [],
          createdAt: new Date().toISOString(),
        }),
      );

      const result = await processHook("codex", "Stop", baseInput({
        hook_event_name: "Stop",
        cwd,
        session_id: "codex:different-session",
        stop_hook_active: false,
      }));

      expect(result.action).toBe("block");
      expect(result.reason).toContain("Continue the gxpm workflow now");
    } finally {
      if (orig === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
      else process.env.CODEX_COMPANION_SESSION_ID = orig;
    }
  });

  test("no active grants leaves stop unblocked", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-stop-empty-"));
    createIssueState({ root: cwd, issueId: "GXPM-1" });

    const result = await processHook("codex", "Stop", baseInput({
      hook_event_name: "Stop",
      cwd,
      session_id: "codex:any-session",
      stop_hook_active: false,
    }));

    expect(result.action).toBe("allow");
    expect(result.reason).toBeUndefined();
  });
});

describe("processHook PreToolUse", () => {
  test("non-update_plan tool → allow no action", async () => {
    const result = await processHook("codex", "PreToolUse", baseInput({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    }));
    expect(result.action).toBe("allow");
    expect(result.exitCode).toBe(0);
  });

  test("update_plan without cwd → allow no action", async () => {
    const result = await processHook("codex", "PreToolUse", baseInput({
      hook_event_name: "PreToolUse",
      tool_name: "update_plan",
      cwd: "",
    }));
    expect(result.action).toBe("allow");
    expect(result.exitCode).toBe(0);
  });

  test("update_plan in uninitialized repo does not create .gxpm", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ptu-uninit-"));

    const result = await processHook("codex", "PreToolUse", baseInput({
      hook_event_name: "PreToolUse",
      tool_name: "update_plan",
      cwd,
      tool_input: { steps: [{ description: "read file" }] },
    }));

    expect(result.action).toBe("allow");
    expect(existsSync(join(cwd, ".gxpm"))).toBe(false);
  });

  test("update_plan in partial repo does not write orphan log", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ptu-partial-"));
    mkdirSync(join(cwd, ".gxpm", "issues"), { recursive: true });

    const result = await processHook("codex", "PreToolUse", baseInput({
      hook_event_name: "PreToolUse",
      tool_name: "update_plan",
      cwd,
      tool_input: { steps: [{ description: "read file" }] },
    }));

    expect(result.action).toBe("allow");
    expect(existsSync(join(cwd, ".gxpm", "codex-plans-orphan.jsonl"))).toBe(false);
  });

  test("update_plan records to orphan log when initialized and no active issue", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-ptu-orphan-"));
    createInitializedGxpmProject(cwd);

    const result = await processHook("codex", "PreToolUse", baseInput({
      hook_event_name: "PreToolUse",
      tool_name: "update_plan",
      cwd,
      tool_input: { steps: [{ description: "read file" }] },
    }));

    expect(result.action).toBe("allow");
    const logPath = join(cwd, ".gxpm", "codex-plans-orphan.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).arguments.steps[0].description).toBe("read file");
  });
});

describe("end-to-end through gxpm CLI", () => {
  test("gxpm hook SessionStart --host codex with repo context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-hook-e2e-ss-"));
    createInitializedGxpmProject(cwd);
    mkdirSync(join(cwd, "core"), { recursive: true });
    writeFileSync(join(cwd, "core", "state.ts"), "export const CURRENT_SCHEMA_VERSION = 7;\n");

    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const result = Bun.spawnSync({
      cmd: [gxpmBin, "hook", "SessionStart", "--host", "codex"],
      cwd,
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd, hook_event_name: "SessionStart" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GXPM_UPDATE_CHECK_BIN: "/does/not/exist" },
    });

    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("schema v7");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  test("gxpm hook UserPromptSubmit --host codex ignores plain prompt", async () => {
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const result = Bun.spawnSync({
      cmd: [gxpmBin, "hook", "UserPromptSubmit", "--host", "codex"],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: "/tmp", hook_event_name: "UserPromptSubmit", prompt: "hello" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("gxpm hook without --host prints usage and exits 1", async () => {
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const result = Bun.spawnSync({
      cmd: [gxpmBin, "hook", "SessionStart"],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--host");
  });

  test("gxpm hook with invalid --host prints usage and exits 1", async () => {
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const result = Bun.spawnSync({
      cmd: [gxpmBin, "hook", "SessionStart", "--host", "unknown"],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--host");
  });

  test("gxpm hook with invalid stdin JSON fails open (exit 0)", async () => {
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const result = Bun.spawnSync({
      cmd: [gxpmBin, "hook", "SessionStart", "--host", "codex"],
      stdin: new TextEncoder().encode("not-json{{"),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
  });
});
