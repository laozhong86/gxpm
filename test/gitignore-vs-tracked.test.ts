import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;

function gitLsFiles(): string[] {
  const r = spawnSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf-8" });
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

function gitignorePatterns(): string[] {
  const gi = readFileSync(join(REPO_ROOT, ".gitignore"), "utf-8");
  return gi
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}

describe("GXPM-160: .gitignore patterns must not collide with tracked files", () => {
  test("node_modules is no longer tracked by git", () => {
    const r = spawnSync("git", ["ls-files", "node_modules"], { cwd: REPO_ROOT, encoding: "utf-8" });
    expect((r.stdout ?? "").trim()).toBe("");
  });

  test(".gitignore still ignores node_modules", () => {
    const gi = readFileSync(join(REPO_ROOT, ".gitignore"), "utf-8");
    expect(gi).toMatch(/^node_modules\/?$/m);
  });

  // GXPM-151: worktree-local state files
  test(".gxpm-worktree-owner.json is no longer tracked", () => {
    const r = spawnSync("git", ["ls-files", ".gxpm-worktree-owner.json"], { cwd: REPO_ROOT, encoding: "utf-8" });
    expect((r.stdout ?? "").trim()).toBe("");
  });

  test("ISSUE_CONTEXT.md is no longer tracked", () => {
    const r = spawnSync("git", ["ls-files", "ISSUE_CONTEXT.md"], { cwd: REPO_ROOT, encoding: "utf-8" });
    expect((r.stdout ?? "").trim()).toBe("");
  });

  test(".gitignore lists both worktree-local state files", () => {
    const gi = readFileSync(join(REPO_ROOT, ".gitignore"), "utf-8");
    expect(gi).toMatch(/^\.gxpm-worktree-owner\.json$/m);
    expect(gi).toMatch(/^ISSUE_CONTEXT\.md$/m);
  });

  test("no gitignore root entry is simultaneously tracked at top level", () => {
    // Only check simple top-level entries (no slashes, no globs) to keep this
    // O(n) and avoid false positives on complex patterns.
    const patterns = gitignorePatterns()
      .map((p) => p.replace(/\/$/, ""))
      .filter((p) => !p.includes("/") && !p.includes("*"));
    const tracked = new Set(gitLsFiles().map((f) => f.split("/")[0]));
    const collisions = patterns.filter((p) => tracked.has(p));
    if (collisions.length > 0) {
      throw new Error(
        `gitignore-vs-tracked collision: these top-level names are both in .gitignore and tracked: ${collisions.join(", ")}`,
      );
    }
    expect(collisions.length).toBe(0);
  });
});
