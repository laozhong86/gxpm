import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readArtifact } from "../core/artifacts";
import { appendIssueEvent, getIssuePaths, readIssueState } from "../core/state";

export function runCleanupLandCommand(argv: string[], issueId: string): void {
  const root = process.cwd();
  const execute = argv.includes("--execute");
  const force = argv.includes("--force");

  // 1. Read issue state and verify phase
  const state = readIssueState({ root, issueId });
  if (state.currentPhase !== "land") {
    throw new Error("cleanup only applies to landed issues");
  }

  // 2. Resolve cleanup target. Standard/full rigor issues carry this in the
  // dispatch-handoff artifact; lite-rigor issues skip dispatch entirely
  // (GXPM-152), so we fall back to the conventional worktree path/branch name
  // when dispatch-handoff is absent.
  let worktree: string | undefined;
  let branch: string | undefined;
  let resolvedFrom: "dispatch-handoff" | "lite-convention" = "dispatch-handoff";

  try {
    const artifact = readArtifact({ root, issueId, type: "dispatch-handoff" });
    const handoffPayload = artifact.payload as Record<string, unknown>;
    worktree = (handoffPayload.worktree ?? handoffPayload.workspace ?? handoffPayload.worktreePath) as
      | string
      | undefined;
    branch = (handoffPayload.branch ?? handoffPayload.targetBranch) as string | undefined;
  } catch {
    // No dispatch-handoff: lite rigor path. Use conventional worktree path and branch.
    if (state.rigorLevel === "lite") {
      worktree = resolve(root, ".gxpm", "worktrees", `gxpm-${issueId}`);
      branch = `gxpm-${issueId}`;
      resolvedFrom = "lite-convention";
    } else {
      throw new Error(
        `cleanup requires dispatch-handoff artifact (rigorLevel=${state.rigorLevel ?? "unknown"}). ` +
          `If this is a lite-rigor issue with a worktree at .gxpm/worktrees/gxpm-${issueId}, ensure state.rigorLevel="lite".`,
      );
    }
  }

  if (!worktree) {
    throw new Error(
      `cleanup requires worktree (resolvedFrom=${resolvedFrom}). For dispatch-handoff path, set payload.worktree/workspace/worktreePath.`,
    );
  }
  if (!branch) {
    throw new Error(
      `cleanup requires branch (resolvedFrom=${resolvedFrom}). For dispatch-handoff path, set payload.branch/targetBranch.`,
    );
  }

  // GXPM-152: for lite path, also verify the conventional worktree directory actually exists
  // before proceeding; otherwise produce a clearer error than the downstream git failure.
  if (resolvedFrom === "lite-convention" && !existsSync(worktree)) {
    throw new Error(
      `cleanup: lite-convention worktree not found at ${worktree}. ` +
        `Either the worktree was already cleaned, or rigorLevel="lite" was set without a workspace. ` +
        `Run 'git worktree list' to check.`,
    );
  }

  // 3. Reject dangerous targets
  const resolvedWorktree = resolve(worktree);
  const resolvedRoot = resolve(root);
  if (resolvedWorktree === resolvedRoot || branch === "main") {
    throw new Error("refusing to clean main worktree/branch");
  }

  // 4. Dry-run (default)
  if (!execute) {
    console.log(`WOULD REMOVE worktree: ${worktree}`);
    console.log(`WOULD DELETE branch: ${branch}`);
    return;
  }

  // 5. Execute mode: assert clean worktree
  const statusResult = Bun.spawnSync({
    cmd: ["git", "status", "--short"],
    cwd: worktree,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (statusResult.exitCode !== 0) {
    throw new Error(`worktree dirty, refusing to remove; commit or stash first`);
  }
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput.length > 0) {
    throw new Error(`worktree dirty, refusing to remove; commit or stash first`);
  }

  // 6. Assert current cwd is not inside target worktree
  const cwdResolved = resolve(process.cwd());
  if (cwdResolved === resolvedWorktree || cwdResolved.startsWith(resolvedWorktree + "/")) {
    throw new Error("currently inside target worktree; cd out first");
  }

  // 7. Remove worktree
  const removeResult = Bun.spawnSync({
    cmd: ["git", "worktree", "remove", worktree],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (removeResult.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${removeResult.stderr.toString().trim()}`);
  }

  // 8. Delete branch
  const branchFlag = force ? "-D" : "-d";
  const branchResult = Bun.spawnSync({
    cmd: ["git", "branch", branchFlag, branch],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (branchResult.exitCode !== 0) {
    const stderr = branchResult.stderr.toString().trim();
    if (!force) {
      throw new Error(`${stderr}\nrerun with --force to delete unmerged branch`);
    }
    throw new Error(`git branch -D failed: ${stderr}`);
  }

  // 9. Append cleanup.executed event on success only
  const paths = getIssuePaths(root, issueId);
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "cleanup.executed",
      issueId,
      timestamp: new Date().toISOString(),
      payload: { worktree, branch, forced: force, dryRun: false },
    },
  });

  // 10. Archive issue directory to .gxpm/archive/
  const archiveDir = join(root, ".gxpm", "archive", `${new Date().toISOString().split("T")[0]}-${issueId}`);
  try {
    copyDirRecursive(paths.issueDir, archiveDir);
    console.log(`archived issue: ${archiveDir}`);
  } catch (err) {
    console.warn(`archive failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`removed worktree: ${worktree}`);
  console.log(`deleted branch: ${branch}`);
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
