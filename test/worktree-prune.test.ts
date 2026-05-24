import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runCli, output } from "./helpers/workflow";

// Feature: gxpm worktree prune
//
// Identifies .gxpm/worktrees/<dir> entries that are no longer registered in
// `git worktree list` (orphans left behind by partial cleanup-land failures
// before GXPM-182). Default --dry-run lists candidates; --execute deletes.
// Only prunes when the corresponding issue is in terminal phase (land) or
// has no state.json at all. Active-issue worktrees are reported and skipped.

describe("gxpm worktree prune", () => {
  test("scn-01: dry-run lists orphan worktrees not in git worktree list", () => {
    const repo = setupRepo();
    addOrphanWorktree(repo, "GXPM-700", "land");
    addOrphanWorktree(repo, "GXPM-701", "land");
    // Register one real worktree (the seed branch) so git worktree list isn't empty.

    const result = runCli(repo, ["worktree", "prune"]);

    expect(result.exitCode).toBe(0);
    const text = output(result);
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("gxpm-GXPM-700");
    expect(text).toContain("gxpm-GXPM-701");

    // No filesystem change.
    expect(existsSync(join(repo, ".gxpm", "worktrees", "gxpm-GXPM-700"))).toBe(true);
    expect(existsSync(join(repo, ".gxpm", "worktrees", "gxpm-GXPM-701"))).toBe(true);
  });

  test("scn-02: --execute prunes orphans whose issue is in terminal phase=land", () => {
    const repo = setupRepo();
    addOrphanWorktree(repo, "GXPM-710", "land");

    const result = runCli(repo, ["worktree", "prune", "--execute"]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(repo, ".gxpm", "worktrees", "gxpm-GXPM-710"))).toBe(false);
    // State preserved by default (--keep-state implicit).
    expect(existsSync(join(repo, ".gxpm", "issues", "GXPM-710", "state.json"))).toBe(true);
  });

  test("scn-03: skips orphan whose issue is in non-terminal phase", () => {
    const repo = setupRepo();
    addOrphanWorktree(repo, "GXPM-720", "implement"); // active

    const result = runCli(repo, ["worktree", "prune", "--execute"]);

    expect(result.exitCode).toBe(0);
    const text = output(result);
    expect(text).toContain("gxpm-GXPM-720");
    expect(text.toLowerCase()).toContain("block"); // blocked / blocked from prune
    expect(existsSync(join(repo, ".gxpm", "worktrees", "gxpm-GXPM-720"))).toBe(true);
  });

  test("scn-04: --age-days filter keeps fresh dirs even if orphan", () => {
    const repo = setupRepo();
    // Fresh orphan (mtime = now)
    addOrphanWorktree(repo, "GXPM-730", "land");

    const result = runCli(repo, ["worktree", "prune", "--execute", "--age-days", "1"]);

    expect(result.exitCode).toBe(0);
    // Fresh dir kept because age 0 < 1 day.
    expect(existsSync(join(repo, ".gxpm", "worktrees", "gxpm-GXPM-730"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "gxpm-prune-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "t@t.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  writeFileSync(join(repo, "README.md"), "init");
  execSync("git add README.md", { cwd: repo });
  execSync('git commit -m "init"', { cwd: repo });
  mkdirSync(join(repo, ".gxpm", "worktrees"), { recursive: true });
  return repo;
}

function addOrphanWorktree(repo: string, issueId: string, phase: string) {
  const wtDir = join(repo, ".gxpm", "worktrees", `gxpm-${issueId}`);
  mkdirSync(wtDir, { recursive: true });
  writeFileSync(join(wtDir, "marker.txt"), "orphan");
  // Make it look aged: set mtime to a few days ago for non-fresh tests.
  // For age tests, leave fresh (default mtime = now).
  if (phase === "land" || phase === "implement") {
    const issueDir = join(repo, ".gxpm", "issues", issueId);
    mkdirSync(issueDir, { recursive: true });
    writeFileSync(
      join(issueDir, "state.json"),
      JSON.stringify({ issueId, currentPhase: phase }),
    );
  }
}

function ageWorktree(repo: string, issueId: string, days: number) {
  const wtDir = join(repo, ".gxpm", "worktrees", `gxpm-${issueId}`);
  const past = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  utimesSync(wtDir, past, past);
}
