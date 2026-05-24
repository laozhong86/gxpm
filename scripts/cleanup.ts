import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { readArtifact } from "../core/artifacts";
import { assertLandCompletion } from "../core/land-completion";
import { appendIssueEvent, getIssuePaths, readIssueState } from "../core/state";
import { unregisterRegistryPath } from "../core/gitnexus-registry";

export function runCleanupLandCommand(argv: string[], issueId: string): void {
  const root = process.cwd();
  const execute = argv.includes("--execute");
  const force = argv.includes("--force");
  const keepSource = argv.includes("--keep-source");

  // 1. Read issue state and verify phase
  const state = readIssueState({ root, issueId });
  if (state.currentPhase !== "land") {
    throw new Error("cleanup only applies to landed issues");
  }
  assertLandCompletion({ root, issueId, action: "cleanup" });

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

  // 11a. GXPM-201: unregister the deleted worktree from the GitNexus registry
  // BEFORE the reindex below, so a stale entry never lingers across crash boundaries.
  // Telemetry events land in the archive copy because the source dir is gone after step 12.
  triggerGitNexusUnregister({ issueDir: archiveDir, issueId, worktreePath: worktree });

  // 11b. GXPM-190 + GXPM-192: fire-and-forget GitNexus reindex.
  triggerGitNexusReindex({ root, issueDir: archiveDir, issueId });

  // 12. GXPM-192: delete source issue directory after archive copy succeeded.
  //     --keep-source preserves the source dir and emits source.kept to both
  //     archive and source so the audit trail stays linked in either path.
  if (keepSource) {
    const keptAt = new Date().toISOString();
    const keptEvent = {
      schemaVersion: 1 as const,
      type: "source.kept" as const,
      issueId,
      timestamp: keptAt,
      payload: {
        sourcePath: paths.issueDir,
        archivePath: archiveDir,
        keptAt,
        reason: "--keep-source flag",
      },
    };
    appendIssueEvent({ issueDir: archiveDir, event: keptEvent });
    appendIssueEvent({ issueDir: paths.issueDir, event: keptEvent });
  } else {
    const deletedAt = new Date().toISOString();
    try {
      rmSync(paths.issueDir, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendIssueEvent({
        issueDir: archiveDir,
        event: {
          schemaVersion: 1,
          type: "source.delete.failed",
          issueId,
          timestamp: new Date().toISOString(),
          payload: {
            sourcePath: paths.issueDir,
            archivePath: archiveDir,
            error: message,
          },
        },
      });
      throw new Error(
        `source dir delete failed (archive preserved at ${archiveDir}): ${message}`,
      );
    }
    appendIssueEvent({
      issueDir: archiveDir,
      event: {
        schemaVersion: 1,
        type: "source.deleted",
        issueId,
        timestamp: deletedAt,
        payload: {
          sourcePath: paths.issueDir,
          archivePath: archiveDir,
          deletedAt,
        },
      },
    });
  }

  console.log(`removed worktree: ${worktree}`);
  console.log(`deleted branch: ${branch}`);
}

/**
 * GXPM-190: fire-and-forget GitNexus reindex after cleanup land completes.
 *
 * - `GXPM_GITNEXUS_REINDEX_MODE=mock`      → emit triggered event, skip spawn
 *                                           (used in tests to avoid spawning real CLI)
 * - `GXPM_GITNEXUS_REINDEX_MODE=mock-fail` → emit failed event, skip spawn
 * - unset / "auto"                         → detached `npx gitnexus analyze`,
 *                                           emit triggered event regardless of
 *                                           child outcome (it runs after parent exit)
 *
 * Errors are caught + logged; this function never throws, so `gxpm cleanup land`
 * always exits with the cleanup result, not the reindex outcome.
 */
function triggerGitNexusReindex(input: { root: string; issueDir: string; issueId: string }): void {
  const mode = process.env.GXPM_GITNEXUS_REINDEX_MODE ?? "auto";
  const now = new Date().toISOString();
  try {
    if (mode === "mock-fail") {
      appendIssueEvent({
        issueDir: input.issueDir,
        event: {
          schemaVersion: 1,
          type: "gitnexus.reindex.failed",
          issueId: input.issueId,
          timestamp: now,
          payload: { mode, errorMessage: "mock-fail: simulated reindex failure" },
        },
      });
      return;
    }
    if (mode !== "mock") {
      // Real reindex: detached so parent exits immediately. Output goes to /dev/null
      // because cleanup land has already printed its own summary.
      Bun.spawn({
        cmd: ["npx", "gitnexus", "analyze"],
        cwd: input.root,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      }).unref();
    }
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "gitnexus.reindex.triggered",
        issueId: input.issueId,
        timestamp: now,
        payload: { mode, command: "npx gitnexus analyze" },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      appendIssueEvent({
        issueDir: input.issueDir,
        event: {
          schemaVersion: 1,
          type: "gitnexus.reindex.failed",
          issueId: input.issueId,
          timestamp: now,
          payload: { mode, errorMessage: message },
        },
      });
    } catch {
      // best-effort
    }
    console.warn(`gitnexus reindex dispatch failed (non-blocking): ${message}`);
  }
}

/**
 * GXPM-201: fire-and-forget GitNexus registry unregister after cleanup land
 * deletes the worktree. Reuses GXPM_GITNEXUS_REINDEX_MODE for the test stub
 * switch so the unregister telemetry shares the same mock surface as reindex:
 *
 * - mock      → emit triggered event with removed=true, skip disk write
 * - mock-fail → emit failed event, skip disk write
 * - else      → call unregisterRegistryPath; emit triggered (with the real
 *               removed flag) or failed if the registry call throws.
 *
 * Errors are caught and logged; cleanup land's exit code is never affected.
 */
function triggerGitNexusUnregister(input: {
  issueDir: string;
  issueId: string;
  worktreePath: string;
}): void {
  const mode = process.env.GXPM_GITNEXUS_REINDEX_MODE ?? "auto";
  const now = new Date().toISOString();
  try {
    if (mode === "mock-fail") {
      appendIssueEvent({
        issueDir: input.issueDir,
        event: {
          schemaVersion: 1,
          type: "gitnexus.unregister.failed",
          issueId: input.issueId,
          timestamp: now,
          payload: { mode, path: input.worktreePath, errorMessage: "mock-fail: simulated unregister failure" },
        },
      });
      return;
    }
    let removed = true;
    let registryPath: string | undefined;
    if (mode !== "mock") {
      const outcome = unregisterRegistryPath({ worktreePath: input.worktreePath });
      removed = outcome.removed;
      registryPath = outcome.registryPath;
    }
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "gitnexus.unregister.triggered",
        issueId: input.issueId,
        timestamp: now,
        payload: { mode, path: input.worktreePath, removed, registryPath },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      appendIssueEvent({
        issueDir: input.issueDir,
        event: {
          schemaVersion: 1,
          type: "gitnexus.unregister.failed",
          issueId: input.issueId,
          timestamp: now,
          payload: { mode, path: input.worktreePath, errorMessage: message },
        },
      });
    } catch {
      // best-effort
    }
    console.warn(`gitnexus unregister dispatch failed (non-blocking): ${message}`);
  }
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
