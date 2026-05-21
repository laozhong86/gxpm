import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "../core/artifacts";
import { getIssuePaths } from "../core/state";
import { enterPhase, output, runCli } from "./helpers/workflow";

describe("cleanup land command", () => {
  test("dry-run prints WOULD REMOVE and WOULD DELETE lines", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-dry-run-"));
    enterLandedIssue(root, "GXPM-700");

    const result = runCli(root, ["cleanup", "land", "GXPM-700"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("WOULD REMOVE worktree:");
    expect(output(result)).toContain("WOULD DELETE branch:");
  });

  test("dry-run accepts dispatch-handoff payload.workspace as worktree target", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-workspace-field-"));
    const worktreePath = "/tmp/GXPM-716";
    enterLandedIssue(root, "GXPM-716", {
      workspace: worktreePath,
      branch: "feature/GXPM-716",
    });

    const result = runCli(root, ["cleanup", "land", "GXPM-716"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain(`WOULD REMOVE worktree: ${worktreePath}`);
    expect(output(result)).toContain("WOULD DELETE branch: feature/GXPM-716");
  });

  test("refusal-path: phase is not land", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-wrong-phase-"));
    // Set up issue in qa phase (not land) to test phase validation
    enterPhase(root, "GXPM-701", "qa");
    writeArtifact({
      root,
      issueId: "GXPM-701",
      type: "dispatch-handoff",
      payload: {
        inputArtifacts: ["acceptance-contract", "implementation-plan"],
        status: "draft",
        stopRule: "",
        targetBranch: "feature/GXPM-701",
        validation: [],
        worktreePath: "/tmp/gxpm-701",
        workerTasks: [],
        worktree: "gxpm-701",
        branch: "feature/GXPM-701",
      },
    });

    const result = runCli(root, ["cleanup", "land", "GXPM-701"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cleanup only applies to landed issues");
  });

  test("refusal-path: dispatch-handoff missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-missing-handoff-"));
    // Set up issue in land phase, then remove the dispatch-handoff artifact
    enterPhase(root, "GXPM-702", "land");
    rmSync(join(root, ".gxpm", "issues", "GXPM-702", "artifacts", "dispatch-handoff.json"));

    const result = runCli(root, ["cleanup", "land", "GXPM-702"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cleanup requires dispatch-handoff artifact");
  });

  test("refusal-path: missing worktree target lists accepted handoff fields", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-missing-target-"));
    enterLandedIssue(root, "GXPM-717", {
      branch: "feature/GXPM-717",
    });

    const result = runCli(root, ["cleanup", "land", "GXPM-717"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cleanup requires worktree");
    expect(output(result)).toContain("payload.worktree/workspace/worktreePath");
  });

  test("execute-path: no cleanup.executed event written when execution fails", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-execute-"));
    enterLandedIssue(root, "GXPM-703");

    const paths = getIssuePaths(root, "GXPM-703");
    // --execute with a nonexistent worktree path will fail at git status or worktree remove
    const result = runCli(root, ["cleanup", "land", "GXPM-703", "--execute"]);

    expect(result.exitCode).toBe(1);

    // Verify no cleanup.executed event was added
    const eventsContent = readFileSync(paths.eventsPath, "utf8");
    const events = eventsContent
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const hasCleanupExecuted = events.some((e: { type: string }) => e.type === "cleanup.executed");
    expect(hasCleanupExecuted).toBe(false);
  });

  test("execute-path: dirty worktree refusal during --execute", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-dirty-"));
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-dirty-"));

    // Set up a real git repo with a linked worktree
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-dirty-"));
    const branch = "feature/GXPM-710";
    addWorktree(repo, worktreePath, branch);

    // Create a dirty (untracked) file in the worktree
    writeFileSync(join(worktreePath, "dirty.txt"), "untracked content");

    enterLandedIssue(root, "GXPM-710", {
      worktree: worktreePath,
      branch,
    });

    const result = runCli(root, ["cleanup", "land", "GXPM-710", "--execute"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("worktree dirty, refusing to remove");

    // No cleanup.executed event written
    const paths = getIssuePaths(root, "GXPM-710");
    expect(readEvents(paths.eventsPath).some((e) => e.type === "cleanup.executed")).toBe(false);
  });

  test("execute-path: cwd inside target worktree refusal", () => {
    // To trigger the cwd check: the subprocess cwd (root) must be inside the worktree path.
    // Strategy: make worktreePath a parent of root so root.startsWith(worktreePath + "/").
    //
    // On macOS, mkdtempSync returns /var/folders/... but process.cwd() in a subprocess
    // returns the realpath /private/var/folders/... so we use realpathSync to normalise
    // all paths to what the subprocess will see.
    const worktreeBaseRaw = mkdtempSync(join(tmpdir(), "gxpm-wt-parent-"));
    const worktreeBase = realpathSync(worktreeBaseRaw);
    const root = join(worktreeBase, "gxpm-state");
    mkdirSync(root, { recursive: true });

    // The worktree path IS worktreeBase, which is a parent of root.
    // git status must succeed (exit 0) so we need a real git repo at worktreeBase.
    // Also add a .gitignore so the gxpm-state subdir doesn't appear as untracked.
    initGitRepo(worktreeBase);
    writeFileSync(join(worktreeBase, ".gitignore"), "gxpm-state/\n");
    execSync("git add .gitignore && git commit -m 'ignore state dir'", { cwd: worktreeBase });

    enterLandedIssue(root, "GXPM-711", {
      worktree: worktreeBase,
      branch: "feature/GXPM-711",
    });

    // runCli sets cwd=root which is inside worktreeBase → triggers cwd check
    const result = runCli(root, ["cleanup", "land", "GXPM-711", "--execute"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("currently inside target worktree");

    const paths = getIssuePaths(root, "GXPM-711");
    expect(readEvents(paths.eventsPath).some((e) => e.type === "cleanup.executed")).toBe(false);
  });

  test("execute-path: unmerged branch default failure with 'rerun with --force'", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-unmerged-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-unmerged-"));
    const branch = "feature/GXPM-712";
    addWorktree(repo, worktreePath, branch);

    // Make an unmerged commit on the feature branch so git branch -d will refuse
    writeFileSync(join(worktreePath, "feature.txt"), "new feature");
    execSync("git add feature.txt", { cwd: worktreePath });
    execSync('git commit -m "feat: add feature GXPM-712"', { cwd: worktreePath });

    enterLandedIssue(repo, "GXPM-712", {
      worktree: worktreePath,
      branch,
    });

    const result = runCli(repo, ["cleanup", "land", "GXPM-712", "--execute"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("rerun with --force");

    const paths = getIssuePaths(repo, "GXPM-712");
    expect(readEvents(paths.eventsPath).some((e) => e.type === "cleanup.executed")).toBe(false);
  });

  test("execute-path: --force deletes unmerged branch successfully", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-force-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-force-"));
    const branch = "feature/GXPM-713";
    addWorktree(repo, worktreePath, branch);

    // Make an unmerged commit on the feature branch
    writeFileSync(join(worktreePath, "feature.txt"), "force-delete me");
    execSync("git add feature.txt", { cwd: worktreePath });
    execSync('git commit -m "feat: unmerged commit GXPM-713"', { cwd: worktreePath });

    enterLandedIssue(repo, "GXPM-713", {
      worktree: worktreePath,
      branch,
    });

    const result = runCli(repo, ["cleanup", "land", "GXPM-713", "--execute", "--force"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("deleted branch:");

    // cleanup.executed event must be present
    const paths = getIssuePaths(repo, "GXPM-713");
    const executedEvents = readEvents(paths.eventsPath).filter(
      (e) => e.type === "cleanup.executed",
    );
    expect(executedEvents.length).toBe(1);
    const payload = executedEvents[0].payload as Record<string, unknown>;
    expect(payload.branch).toBe(branch);
    expect(payload.worktree).toBe(worktreePath);
    expect(payload.forced).toBe(true);
    expect(payload.dryRun).toBe(false);
  });

  test("success path appends exactly one cleanup.executed event with expected payload", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-success-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-success-"));
    const branch = "feature/GXPM-714";
    addWorktree(repo, worktreePath, branch);
    // No extra commits — branch is merged into HEAD already (cut from main with no divergence)

    enterLandedIssue(repo, "GXPM-714", {
      worktree: worktreePath,
      branch,
    });

    const result = runCli(repo, ["cleanup", "land", "GXPM-714", "--execute"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("removed worktree:");
    expect(output(result)).toContain("deleted branch:");

    const paths = getIssuePaths(repo, "GXPM-714");
    const executedEvents = readEvents(paths.eventsPath).filter(
      (e) => e.type === "cleanup.executed",
    );
    expect(executedEvents.length).toBe(1);
    const payload = executedEvents[0].payload as Record<string, unknown>;
    expect(payload.branch).toBe(branch);
    expect(payload.worktree).toBe(worktreePath);
    expect(payload.forced).toBe(false);
    expect(payload.dryRun).toBe(false);
  });

  test("dry-run appends no cleanup.executed event", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-dryrun-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-dryrun-"));
    const branch = "feature/GXPM-715";
    addWorktree(repo, worktreePath, branch);

    enterLandedIssue(repo, "GXPM-715", {
      worktree: worktreePath,
      branch,
    });

    // Dry-run (no --execute flag)
    const result = runCli(repo, ["cleanup", "land", "GXPM-715"]);

    expect(result.exitCode).toBe(0);

    const paths = getIssuePaths(repo, "GXPM-715");
    const executedEvents = readEvents(paths.eventsPath).filter(
      (e) => e.type === "cleanup.executed",
    );
    expect(executedEvents.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function enterLandedIssue(
  root: string,
  issueId: string,
  payload?: Record<string, unknown>,
) {
  enterPhase(root, issueId, "land");
  writeArtifact({
    root,
    issueId,
    type: "dispatch-handoff",
    payload: payload ?? {
      inputArtifacts: ["acceptance-contract", "implementation-plan"],
      status: "draft",
      stopRule: "",
      targetBranch: `feature/${issueId}`,
      validation: [],
      worktreePath: `/tmp/${issueId}`,
      workerTasks: [],
      worktree: issueId,
      branch: `feature/${issueId}`,
    },
  });
}

/** Initialise a bare git repo with one commit so worktrees and branches work. */
function initGitRepo(dir: string) {
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

/** Add a linked worktree at worktreePath on a new branch. */
function addWorktree(repoDir: string, worktreePath: string, branch: string) {
  execSync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: repoDir });
}

/** Parse a JSONL events file and return the event objects. */
function readEvents(eventsPath: string): Array<{ type: string; payload: unknown }> {
  return readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
