import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "../core/artifacts";
import { getIssuePaths } from "../core/state";
import { enterPhase, output, runCli, runCliWithEnv } from "./helpers/workflow";

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

    // cleanup.executed event must be present (GXPM-192: source is deleted, read from archive)
    const executedEvents = readArchiveEvents(repo, "GXPM-713").filter(
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

    // GXPM-192: source is deleted; read events from archive copy instead.
    const executedEvents = readArchiveEvents(repo, "GXPM-714").filter(
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

  // ---------------------------------------------------------------------------
  // GXPM-192: cleanup land 完成后删除源目录 + post-archive 事件去向修正
  // ---------------------------------------------------------------------------

  // Feature: cleanup land deletes the source issue directory after archive
  //
  // Scenario (scn-01): default --execute path 删除 .gxpm/issues/<id>/ 源目录且 archive 副本完整
  //   Given 一个已 land 的 issue，有 clean worktree 与 dispatch-handoff
  //   And  .gxpm/issues/<id>/ 源目录与 archive 目标位置均可写
  //   When 在主仓库以非 worktree cwd 运行 gxpm cleanup land <id> --execute
  //   Then 命令以零状态退出
  //   And  .gxpm/issues/<id>/ 源目录不再存在
  //   And  .gxpm/archive/<date>-<id>/ 副本包含 state.json、events.jsonl、artifacts/
  test("scn-01: default --execute deletes source and preserves complete archive copy", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-scn01-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-scn01-"));
    const branch = "feature/GXPM-901";
    addWorktree(repo, worktreePath, branch);

    enterLandedIssue(repo, "GXPM-901", { worktree: worktreePath, branch });

    const result = runCliWithEnv(
      repo,
      ["cleanup", "land", "GXPM-901", "--execute"],
      { GXPM_GITNEXUS_REINDEX_MODE: "mock" },
    );

    expect(result.exitCode).toBe(0);

    const paths = getIssuePaths(repo, "GXPM-901");
    expect(existsSync(paths.issueDir)).toBe(false);

    const archiveRoot = join(repo, ".gxpm", "archive");
    const archiveEntries = readdirSync(archiveRoot).filter((n) => n.endsWith("-GXPM-901"));
    expect(archiveEntries.length).toBe(1);
    const archiveDir = join(archiveRoot, archiveEntries[0]);
    expect(existsSync(join(archiveDir, "state.json"))).toBe(true);
    expect(existsSync(join(archiveDir, "events.jsonl"))).toBe(true);
    expect(existsSync(join(archiveDir, "artifacts"))).toBe(true);
  });

  // Scenario (scn-02): archive 副本的 events.jsonl 末尾依次包含 cleanup.executed → gitnexus.reindex.triggered → source.deleted
  //   Given 一个已 land 的 issue，GXPM_GITNEXUS_REINDEX_MODE=mock 以确保 reindex 事件可观察
  //   When 在主仓库运行 gxpm cleanup land <id> --execute
  //   Then archive 副本 events.jsonl 末三行类型按顺序为 "cleanup.executed"、"gitnexus.reindex.triggered"、"source.deleted"
  //   And  source.deleted 事件 payload 包含 sourcePath、archivePath、deletedAt
  test("scn-02: archive events.jsonl ends with cleanup.executed then reindex.triggered then source.deleted", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-scn02-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-scn02-"));
    const branch = "feature/GXPM-902";
    addWorktree(repo, worktreePath, branch);

    enterLandedIssue(repo, "GXPM-902", { worktree: worktreePath, branch });

    const result = runCliWithEnv(
      repo,
      ["cleanup", "land", "GXPM-902", "--execute"],
      { GXPM_GITNEXUS_REINDEX_MODE: "mock" },
    );
    expect(result.exitCode).toBe(0);

    const events = readArchiveEvents(repo, "GXPM-902");
    const tailTypes = events.slice(-3).map((e) => e.type);
    expect(tailTypes).toEqual([
      "cleanup.executed",
      "gitnexus.reindex.triggered",
      "source.deleted",
    ]);

    const deleted = events[events.length - 1];
    expect(deleted.type).toBe("source.deleted");
    const payload = deleted.payload as Record<string, unknown>;
    expect(typeof payload.sourcePath).toBe("string");
    expect(typeof payload.archivePath).toBe("string");
    expect(typeof payload.deletedAt).toBe("string");
  });

  // Scenario (scn-03): --keep-source 标志保留源目录并记录 source.kept 事件到 archive 与源
  //   Given 一个已 land 的 issue
  //   When 在主仓库运行 gxpm cleanup land <id> --execute --keep-source
  //   Then 命令以零状态退出
  //   And  .gxpm/issues/<id>/ 源目录仍存在
  //   And  archive 副本 events.jsonl 末尾包含 source.kept 事件
  //   And  源 events.jsonl 末尾也包含相同的 source.kept 事件
  test("scn-03: --keep-source flag retains source and writes source.kept to both archive and source", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-scn03-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-scn03-"));
    const branch = "feature/GXPM-903";
    addWorktree(repo, worktreePath, branch);

    enterLandedIssue(repo, "GXPM-903", { worktree: worktreePath, branch });

    const result = runCliWithEnv(
      repo,
      ["cleanup", "land", "GXPM-903", "--execute", "--keep-source"],
      { GXPM_GITNEXUS_REINDEX_MODE: "mock" },
    );
    expect(result.exitCode).toBe(0);

    const paths = getIssuePaths(repo, "GXPM-903");
    expect(existsSync(paths.issueDir)).toBe(true);

    const archiveEvents = readArchiveEvents(repo, "GXPM-903");
    const archiveKept = archiveEvents.filter((e) => e.type === "source.kept");
    expect(archiveKept.length).toBe(1);

    const sourceEvents = readEvents(paths.eventsPath);
    const sourceKept = sourceEvents.filter((e) => e.type === "source.kept");
    expect(sourceKept.length).toBe(1);

    expect((archiveKept[0].payload as Record<string, unknown>).reason).toBe(
      (sourceKept[0].payload as Record<string, unknown>).reason,
    );
  });

  // Scenario (scn-04): 源目录删除失败时保留双份完整并以非零状态退出
  //   Given 一个已 land 的 issue
  //   And  源目录无法删除（注入一个只读子目录或被外部 fd 占用，触发 rmSync 抛错）
  //   When 在主仓库运行 gxpm cleanup land <id> --execute
  //   Then 命令以非零状态退出
  //   And  .gxpm/issues/<id>/ 源目录仍存在且内容完整
  //   And  .gxpm/archive/<date>-<id>/ 副本仍存在且内容完整
  //   And  archive 副本 events.jsonl 末尾包含 source.delete.failed 事件含 error 字段
  test("scn-04: source deletion failure keeps both copies intact and exits non-zero", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-repo-scn04-"));
    initGitRepo(repo);
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-wt-scn04-"));
    const branch = "feature/GXPM-904";
    addWorktree(repo, worktreePath, branch);

    enterLandedIssue(repo, "GXPM-904", { worktree: worktreePath, branch });

    // Inject a deletion failure by chmod-locking the issue directory so
    // rmSync cannot remove its entries (EACCES bubbles past {force: true}).
    const paths = getIssuePaths(repo, "GXPM-904");
    chmodSync(paths.issueDir, 0o500);

    try {
      const result = runCliWithEnv(
        repo,
        ["cleanup", "land", "GXPM-904", "--execute"],
        { GXPM_GITNEXUS_REINDEX_MODE: "mock" },
      );

      expect(result.exitCode).not.toBe(0);
      expect(existsSync(paths.issueDir)).toBe(true);
      expect(existsSync(paths.eventsPath)).toBe(true);

      const archiveDir = findArchiveDir(repo, "GXPM-904");
      expect(existsSync(join(archiveDir, "state.json"))).toBe(true);
      expect(existsSync(join(archiveDir, "events.jsonl"))).toBe(true);

      const archiveEvents = readArchiveEvents(repo, "GXPM-904");
      const failed = archiveEvents.filter((e) => e.type === "source.delete.failed");
      expect(failed.length).toBe(1);
      const payload = failed[0].payload as Record<string, unknown>;
      expect(typeof payload.error).toBe("string");
      expect((payload.error as string).length).toBeGreaterThan(0);
    } finally {
      // restore perms so afterAll temp cleanup can succeed
      chmodSync(paths.issueDir, 0o700);
    }
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

/** Resolve the archive directory for an issueId under repo's .gxpm/archive/. */
function findArchiveDir(repo: string, issueId: string): string {
  const archiveRoot = join(repo, ".gxpm", "archive");
  const entries = readdirSync(archiveRoot).filter((n) => n.endsWith(`-${issueId}`));
  if (entries.length !== 1) {
    throw new Error(`expected exactly one archive entry for ${issueId}, found ${entries.length}`);
  }
  return join(archiveRoot, entries[0]);
}

/** Read events.jsonl from the archive copy for an issue (post-cleanup-land). */
function readArchiveEvents(repo: string, issueId: string): Array<{ type: string; payload: unknown }> {
  return readEvents(join(findArchiveDir(repo, issueId), "events.jsonl"));
}
