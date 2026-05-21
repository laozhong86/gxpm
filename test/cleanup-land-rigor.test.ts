import { describe, test, expect } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState } from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { runCleanupLandCommand } from "../scripts/cleanup";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-cleanup-rigor-"));
}

function setupIssueAtLand(root: string, opts: { rigor: "lite" | "standard" | "full" }) {
  const sha = initGitCommit(root);
  const issueId = "GXPM-TEST-1";
  const issueType = opts.rigor === "lite" ? "meta" : "feature";
  createIssueState({ root, issueId, issueType });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.currentPhase = "land";
  state.rigorLevel = opts.rigor;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  writeArtifact({
    root,
    issueId,
    type: "pr-check",
    payload: {
      status: "approved",
      pullRequest: { url: "https://github.com/example/repo/pull/1" },
      reviewFindings: [],
    },
  });
  writeArtifact({
    root,
    issueId,
    type: "land-findings",
    payload: {
      landReady: true,
      mergePlan: "merged",
      status: "landed",
      mergedAt: new Date().toISOString(),
      mergedSha: sha,
    },
  });
  return issueId;
}

function initGitCommit(root: string) {
  execSync("git init -q", { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  execSync("git add tracked.txt", { cwd: root });
  execSync(
    "git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name='gxpm test' -c user.email='gxpm@example.test' commit -q -m initial",
    { cwd: root },
  );
  return execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
}

function captureStdout<T>(fn: () => T): { result: T; output: string } {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const result = fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = origLog;
  }
}

describe("GXPM-152: cleanup land compatibility with lite rigor", () => {
  test("scn-01: standard rigor uses dispatch-handoff path", () => {
    const root = freshRoot();
    const origCwd = process.cwd();
    process.chdir(root);
    try {
      const id = setupIssueAtLand(root, { rigor: "standard" });
      writeArtifact({
        root, issueId: id, type: "dispatch-handoff",
        payload: { status: "ready", inputArtifacts: [], workerTasks: [], worktree: "/tmp/fake-wt", branch: "gxpm-fake" },
      });
      const { output } = captureStdout(() => runCleanupLandCommand([], id));
      expect(output).toContain("WOULD REMOVE worktree: /tmp/fake-wt");
      expect(output).toContain("WOULD DELETE branch: gxpm-fake");
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-02: lite rigor without dispatch-handoff falls back to convention", () => {
    const root = freshRoot();
    const origCwd = process.cwd();
    process.chdir(root);
    try {
      const id = setupIssueAtLand(root, { rigor: "lite" });
      // Create a fake worktree dir at the conventional path so the existence check passes.
      const conventionalWt = join(root, ".gxpm/worktrees", `gxpm-${id}`);
      mkdirSync(conventionalWt, { recursive: true });
      const { output } = captureStdout(() => runCleanupLandCommand([], id));
      // macOS resolves /var/folders to /private/var/folders; just match suffix.
      expect(output).toContain(`.gxpm/worktrees/gxpm-${id}`);
      expect(output).toContain(`WOULD DELETE branch: gxpm-${id}`);
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-03: lite rigor without worktree gives clear error", () => {
    const root = freshRoot();
    const origCwd = process.cwd();
    process.chdir(root);
    try {
      const id = setupIssueAtLand(root, { rigor: "lite" });
      // Do NOT create the conventional worktree dir.
      expect(() => runCleanupLandCommand(["--execute"], id)).toThrow(/lite-convention worktree not found/);
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-04: standard rigor without dispatch-handoff still errors clearly", () => {
    const root = freshRoot();
    const origCwd = process.cwd();
    process.chdir(root);
    try {
      const id = setupIssueAtLand(root, { rigor: "standard" });
      expect(() => runCleanupLandCommand([], id)).toThrow(/dispatch-handoff/);
    } finally {
      process.chdir(origCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
