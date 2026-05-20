import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState } from "../core/state";
import { evaluateBashToolGate, SHELL_TOOL_NAMES } from "../core/hook-engine";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-multi-shell-"));
}

function setupInitializedIssue(root: string, issueId: string, phase: string) {
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, ".gxpm/config.json"), "{}\n");
  createIssueState({ root, issueId, issueType: "feature" });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.currentPhase = phase;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
  writeFileSync(
    join(root, ".gxpm-worktree-owner.json"),
    JSON.stringify({
      ownerIssueId: issueId, linkedIssues: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      branchName: `gxpm-${issueId}`, workspacePath: root,
    }),
  );
}

function mkInput(root: string, toolName: string, toolInput: unknown) {
  return {
    session_id: "test", cwd: root, hook_event_name: "PreToolUse",
    tool_name: toolName, tool_input: toolInput,
  } as any;
}

describe("GXPM-171: shell gate recognizes multiple host tool names", () => {
  test("SHELL_TOOL_NAMES exposes the canonical set", () => {
    expect(SHELL_TOOL_NAMES.has("Bash")).toBe(true);
    expect(SHELL_TOOL_NAMES.has("bash")).toBe(true);
    expect(SHELL_TOOL_NAMES.has("shell")).toBe(true);
    expect(SHELL_TOOL_NAMES.has("run_command")).toBe(true);
  });

  test("scn-01: toolName=shell in self-review blocks force-push", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "shell", { command: "git push --force origin main" }));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: toolName=run_command blocks", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "run_command", { command: "git push --force origin main" }));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: tool_input as raw string is extracted", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "shell", "git push --force origin main"));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-04: toolName=Bash still blocks (regression)", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "Bash", { command: "git push --force origin main" }));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bonus: tool_input with 'cmd' field (alt naming) is extracted", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "run_command", { cmd: "git push --force origin main" }));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
