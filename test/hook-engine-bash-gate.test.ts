import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState } from "../core/state";
import { evaluateBashToolGate } from "../core/hook-engine";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-bash-gate-"));
}

function setupInitializedIssue(root: string, issueId: string, phase: string) {
  // Satisfy getProjectInitializationStatus's required markers.
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, ".gxpm/config.json"), "{}\n");
  createIssueState({ root, issueId, issueType: "feature" });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.currentPhase = phase;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
  // Mark this issue as the active one via .gxpm-worktree-owner.json
  writeFileSync(
    join(root, ".gxpm-worktree-owner.json"),
    JSON.stringify({
      ownerIssueId: issueId,
      linkedIssues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      branchName: `gxpm-${issueId}`,
      workspacePath: root,
    }),
  );
}

function mkInput(root: string, command: string) {
  return {
    session_id: "test",
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  } as any;
}

describe("GXPM-168: Bash gate in processPreToolUse", () => {
  test("scn-01: self-review blocks git push --force", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const r = evaluateBashToolGate(mkInput(root, "git push --force origin main"));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(false);
      expect(r!.reason).toContain("self-review");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: implement allows same command", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "implement");
      const r = evaluateBashToolGate(mkInput(root, "git push --force origin main"));
      expect(r).not.toBeNull();
      expect(r!.allow).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: no issue context → null (caller defaults to allow)", () => {
    const root = fresh();
    try {
      const r = evaluateBashToolGate(mkInput(root, "git push --force"));
      // Uninitialized repo → null
      expect(r).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-04: GXPM_BYPASS_TOOL_GATE=1 short-circuits to allow", () => {
    const root = fresh();
    try {
      setupInitializedIssue(root, "GXPM-T-1", "self-review");
      const prev = process.env.GXPM_BYPASS_TOOL_GATE;
      process.env.GXPM_BYPASS_TOOL_GATE = "1";
      try {
        const r = evaluateBashToolGate(mkInput(root, "git push --force"));
        expect(r).not.toBeNull();
        expect(r!.allow).toBe(true);
        expect(r!.reason).toContain("BYPASS");
      } finally {
        if (prev === undefined) delete process.env.GXPM_BYPASS_TOOL_GATE;
        else process.env.GXPM_BYPASS_TOOL_GATE = prev;
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
