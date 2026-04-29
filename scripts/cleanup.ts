import { resolve } from "node:path";
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

  // 2. Resolve cleanup target from dispatch-handoff artifact
  let handoffPayload: Record<string, unknown>;
  try {
    const artifact = readArtifact({ root, issueId, type: "dispatch-handoff" });
    handoffPayload = artifact.payload as Record<string, unknown>;
  } catch {
    throw new Error("cleanup requires dispatch-handoff artifact");
  }

  // Prefer newer fields (worktree / branch), then current handoff workspace,
  // and finally legacy worktreePath / targetBranch.
  const worktree = (handoffPayload.worktree ?? handoffPayload.workspace ?? handoffPayload.worktreePath) as
    | string
    | undefined;
  const branch = (handoffPayload.branch ?? handoffPayload.targetBranch) as string | undefined;

  if (!worktree) {
    throw new Error(
      "cleanup requires one of dispatch-handoff.payload.worktree, dispatch-handoff.payload.workspace, or dispatch-handoff.payload.worktreePath",
    );
  }
  if (!branch) {
    throw new Error("cleanup requires dispatch-handoff.payload.branch");
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

  console.log(`removed worktree: ${worktree}`);
  console.log(`deleted branch: ${branch}`);
}
