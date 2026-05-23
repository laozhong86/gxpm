// Feature: gxpm gitnexus prune removes dangling GitNexus registry entries
//
// As a gxpm operator
// I want a CLI that audits ~/.gitnexus/registry.json and removes dangling entries
// So that the registry stays consistent with the worktrees currently on disk
//
// Scenario (scn-01): dry-run lists dangling entries without writing
//   Given a GitNexus registry containing one valid worktree entry and two dangling entries
//   When the operator runs gxpm gitnexus prune
//   Then the command exits with code 0
//   And the output lists the two dangling entries with their dangling reason
//   And the registry file on disk is unchanged
//
// Scenario (scn-02): execute atomically removes dangling entries
//   Given a GitNexus registry containing one valid worktree entry and two dangling entries
//   When the operator runs gxpm gitnexus prune --execute
//   Then the command exits with code 0
//   And the registry on disk retains only the valid worktree entry
//   And no temporary file is left behind in the registry directory
//
// Scenario (scn-03): registry missing yields a clear error
//   Given the GitNexus registry file does not exist at the expected path
//   When the operator runs gxpm gitnexus prune
//   Then the command exits with code 1
//   And stderr names the missing registry path
//
// Scenario (scn-04): concurrent prune attempts produce no half-written registry
//   Given a GitNexus registry containing one valid worktree entry and one dangling entry
//   When two prune --execute invocations run in parallel against the same registry
//   Then both processes exit successfully
//   And the registry on disk is well-formed JSON containing only the valid entry

import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "scripts", "gxpm.ts");

interface Entry {
  name: string;
  path: string;
  indexedAt: string;
}

function runPrune(home: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", CLI, "gitnexus", "prune", ...args],
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    status: result.exitCode ?? -1,
  };
}

function makeWorktreeRoot(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `gxpm-201-wt-${label}-`));
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "t@t.test"', { cwd: dir });
  execSync('git config user.name "t"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "x");
  execSync("git add README.md && git commit -m init", { cwd: dir });
  return dir;
}

function writeRegistry(home: string, entries: Entry[]): string {
  const registryDir = join(home, ".gitnexus");
  mkdirSync(registryDir, { recursive: true });
  const registryPath = join(registryDir, "registry.json");
  writeFileSync(registryPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return registryPath;
}

function readRegistry(registryPath: string): Entry[] {
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

describe("GXPM-201 gxpm gitnexus prune", () => {
  test("scn-01 dry_run_lists_dangling_entries_without_writing", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-201-home-scn01-"));
    const valid = makeWorktreeRoot("valid01");
    const dangling = mkdtempSync(join(tmpdir(), "gxpm-201-gone01-"));
    // Make the dangling path resolvable-but-not-a-git-root.
    const dangling2 = mkdtempSync(join(tmpdir(), "gxpm-201-gone01b-"));
    const entries: Entry[] = [
      { name: "valid", path: valid, indexedAt: "2026-05-23T00:00:00Z" },
      { name: "ghost", path: dangling, indexedAt: "2026-05-23T00:00:00Z" },
      { name: "stale", path: dangling2, indexedAt: "2026-05-23T00:00:00Z" },
    ];
    const registryPath = writeRegistry(home, entries);
    const before = readFileSync(registryPath, "utf8");

    const result = runPrune(home, []);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(dangling);
    expect(result.stdout).toContain(dangling2);
    expect(result.stdout).not.toContain(valid + "\n"); // not in dropped list
    expect(readFileSync(registryPath, "utf8")).toBe(before);
  });

  test("scn-02 execute_atomically_removes_dangling_entries", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-201-home-scn02-"));
    const valid = makeWorktreeRoot("valid02");
    const dangling = mkdtempSync(join(tmpdir(), "gxpm-201-gone02-"));
    const dangling2 = mkdtempSync(join(tmpdir(), "gxpm-201-gone02b-"));
    const entries: Entry[] = [
      { name: "valid", path: valid, indexedAt: "2026-05-23T00:00:00Z" },
      { name: "ghost", path: dangling, indexedAt: "2026-05-23T00:00:00Z" },
      { name: "stale", path: dangling2, indexedAt: "2026-05-23T00:00:00Z" },
    ];
    const registryPath = writeRegistry(home, entries);

    const result = runPrune(home, ["--execute"]);

    expect(result.status).toBe(0);
    const after = readRegistry(registryPath);
    expect(after).toHaveLength(1);
    expect(after[0].path).toBe(valid);

    // No leftover tmp files in the registry directory.
    const siblings = readdirSync(join(home, ".gitnexus"));
    const tmpSiblings = siblings.filter((n) => n.startsWith("registry.json.tmp-"));
    expect(tmpSiblings).toEqual([]);
  });

  test("scn-03 registry_missing_yields_clear_error", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-201-home-scn03-"));
    // Intentionally do NOT create ~/.gitnexus/registry.json.
    const expectedPath = join(home, ".gitnexus", "registry.json");

    const result = runPrune(home, []);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedPath);
    expect(result.stderr.toLowerCase()).toContain("not found");
  });

  test("scn-04 concurrent_prune_produces_no_half_written_registry", async () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-201-home-scn04-"));
    const valid = makeWorktreeRoot("valid04");
    const dangling = mkdtempSync(join(tmpdir(), "gxpm-201-gone04-"));
    const entries: Entry[] = [
      { name: "valid", path: valid, indexedAt: "2026-05-23T00:00:00Z" },
      { name: "ghost", path: dangling, indexedAt: "2026-05-23T00:00:00Z" },
    ];
    const registryPath = writeRegistry(home, entries);

    const [a, b] = await Promise.all([
      Bun.spawn({
        cmd: ["bun", "run", CLI, "gitnexus", "prune", "--execute"],
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      }).exited,
      Bun.spawn({
        cmd: ["bun", "run", CLI, "gitnexus", "prune", "--execute"],
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      }).exited,
    ]);

    expect(a).toBe(0);
    expect(b).toBe(0);

    // Registry must still be well-formed JSON containing only the valid entry.
    const after = readRegistry(registryPath);
    expect(after).toHaveLength(1);
    expect(after[0].path).toBe(valid);

    // No half-written tmp files lying around.
    const siblings = readdirSync(join(home, ".gitnexus"));
    const tmpSiblings = siblings.filter((n) => n.startsWith("registry.json.tmp-"));
    expect(tmpSiblings).toEqual([]);
  });
});
