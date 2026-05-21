import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorktreeInit, type WorktreeInitContext } from "../core/worktree-init";
import { output, runCliWithEnv } from "./helpers/workflow";
import "../core/worktree-init-steps";

describe("gxpm-managed worktree GitNexus health", () => {
  // Feature: Reliable GitNexus health checks in gxpm-managed worktrees
  //
  // Scenario (scn-01): Worktree commands use the project-declared npm runtime
  //   Given a gxpm-managed worktree created for "GXPM-90"
  //   And the canonical project declares "npm@10.9.2" as its package manager
  //   When an agent runs a Node package command from that worktree
  //   Then the command environment prefers the declared project runtime
  //   And the agent does not silently fall back to a different global npm
  test("worktree_commands_use_the_project_declared_npm_runtime", async () => {
    const { main, wt, matchingBin, cleanup } = makeProjectWithNpmRuntime();
    try {
      const ctx: WorktreeInitContext = {
        canonicalRepoPath: main,
        worktreePath: wt,
        branchName: "gxpm-GXPM-90",
        issueId: "GXPM-90",
      };

      const result = await runWorktreeInit(ctx, {
        steps: ["toolchain-env"],
        root: main,
      });

      expect(result.ok).toBe(true);
      const env = readFileSync(join(wt, ".gxpm-worktree", "env.sh"), "utf8");
      expect(env).toContain(`export PATH="${join(wt, ".gxpm-worktree", "bin")}:${matchingBin}:$PATH"`);
      expect(env).toContain("GXPM_EXPECTED_WORKTREE_ROOT");
    } finally {
      cleanup();
    }
  });

  // Feature: Reliable GitNexus health checks in gxpm-managed worktrees
  //
  // Scenario (scn-02): GitNexus sees the current worktree as the active workspace
  //   Given a gxpm-managed worktree created for "GXPM-90"
  //   And the worktree has its own owner marker
  //   When an agent performs a GitNexus health check from that worktree
  //   Then the health check reports the worktree as the active workspace
  //   And the result does not masquerade as the canonical main checkout
  test("gitnexus_sees_the_current_worktree_as_the_active_workspace", async () => {
    const { main, wt, matchingBin, cleanup } = makeProjectWithNpmRuntime();
    try {
      const ctx: WorktreeInitContext = {
        canonicalRepoPath: main,
        worktreePath: wt,
        branchName: "gxpm-GXPM-90",
        issueId: "GXPM-90",
      };

      const result = await runWorktreeInit(ctx, {
        steps: ["toolchain-env"],
        root: main,
      });

      expect(result.ok).toBe(true);
      const guardPath = join(wt, ".gxpm-worktree", "bin", "gxpm-gitnexus-status");
      expect(existsSync(guardPath)).toBe(true);
      const guard = readFileSync(guardPath, "utf8");
      expect(guard).toContain("GitNexus worktree index missing");
      expect(guard).toContain("git rev-parse --show-toplevel");

      const executed = Bun.spawnSync({
        cmd: [guardPath],
        cwd: wt,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: join(main, "home"), PATH: `${matchingBin}:${process.env.PATH ?? ""}` },
      });
      expect(executed.exitCode).toBe(0);
      expect(executed.stdout.toString()).toContain(`Repository: ${realpathSync(wt)}`);
      expect(executed.stdout.toString()).toContain("Status: up-to-date");
    } finally {
      cleanup();
    }
  });

  // Feature: Reliable GitNexus health checks in gxpm-managed worktrees
  //
  // Scenario (scn-03): Parent repository indexes do not count as worktree health
  //   Given the parent checkout is indexed by GitNexus
  //   And the current worktree has no exact index entry
  //   When an agent performs a GitNexus health check from that worktree
  //   Then the health check reports the missing worktree index
  //   And it gives the exact analyze command needed to make the worktree healthy
  test("parent_repository_index_does_not_count_as_worktree_health", async () => {
    const { main, wt, matchingBin, cleanup } = makeProjectWithNpmRuntime({ exactWorktreeIndex: false });
    try {
      const ctx: WorktreeInitContext = {
        canonicalRepoPath: main,
        worktreePath: wt,
        branchName: "gxpm-GXPM-90",
        issueId: "GXPM-90",
      };

      const result = await runWorktreeInit(ctx, {
        steps: ["toolchain-env"],
        root: main,
      });

      expect(result.ok).toBe(true);
      const guardPath = join(wt, ".gxpm-worktree", "bin", "gxpm-gitnexus-status");
      const executed = Bun.spawnSync({
        cmd: [guardPath],
        cwd: wt,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: join(main, "home"), PATH: `${matchingBin}:${process.env.PATH ?? ""}` },
      });

      expect(executed.exitCode).toBe(87);
      expect(executed.stderr.toString()).toContain(`GitNexus worktree index missing: ${realpathSync(wt)}`);
      expect(executed.stderr.toString()).toContain("npx gitnexus analyze");
    } finally {
      cleanup();
    }
  });

  // Feature: Reliable GitNexus health checks in gxpm-managed worktrees
  //
  // Scenario (scn-04): gxpm exposes a default GitNexus status entrance
  //   Given a gxpm-managed worktree has an exact GitNexus registry entry
  //   When an agent runs the default gxpm GitNexus status command
  //   Then it reports the current worktree path and an up-to-date status
  //   And it does not require the agent to source shell environment first
  test("gxpm_gitnexus_status_reports_exact_worktree_without_shell_setup", () => {
    const { wt, matchingBin, home, cleanup } = makeProjectWithNpmRuntime();
    try {
      const result = runCliWithEnv(wt, ["gitnexus", "status"], {
        HOME: home,
        PATH: `${matchingBin}:${process.env.PATH ?? ""}`,
      });

      expect(result.exitCode).toBe(0);
      expect(output(result)).toContain(`Repository: ${wt}`);
      expect(output(result)).toContain("Status: up-to-date");
    } finally {
      cleanup();
    }
  });

  // Feature: Reliable GitNexus health checks in gxpm-managed worktrees
  //
  // Scenario (scn-05): gxpm exposes a default GitNexus index entrance
  //   Given a gxpm-managed worktree declares npm@10.9.2
  //   And a different npm appears earlier on PATH
  //   When an agent runs the default gxpm GitNexus index command
  //   Then gxpm uses the package-declared npm runtime to invoke npx
  //   And it indexes the current worktree path with --skip-git
  test("gxpm_gitnexus_index_uses_project_declared_npm_runtime", () => {
    const { wt, matchingBin, wrongBin, home, npxLogPath, cleanup } = makeProjectWithNpmRuntime();
    try {
      const result = runCliWithEnv(wt, ["gitnexus", "index", "--no-stats"], {
        HOME: home,
        PATH: `${wrongBin}:${matchingBin}:${process.env.PATH ?? ""}`,
      });

      expect(result.exitCode).toBe(0);
      expect(output(result)).toContain("fake gitnexus indexed");
      const logged = readFileSync(npxLogPath, "utf8");
      expect(logged).toContain(`gitnexus analyze ${wt}`);
      expect(logged).toContain("--skip-git");
      expect(logged).toContain("--name wt");
    } finally {
      cleanup();
    }
  });
});

function makeProjectWithNpmRuntime(options: { exactWorktreeIndex?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gxpm-gitnexus-health-"));
  const main = join(root, "main");
  const wt = join(root, "wt");
  const matchingBin = join(root, "node-v25", "bin");
  const wrongBin = join(root, "homebrew", "bin");
  const home = join(main, "home");
  const npxLogPath = join(root, "npx.log");
  mkdirSync(main, { recursive: true });
  mkdirSync(wt, { recursive: true });
  mkdirSync(join(main, ".gxpm"), { recursive: true });
  mkdirSync(join(home, ".gitnexus"), { recursive: true });
  mkdirSync(matchingBin, { recursive: true });
  mkdirSync(wrongBin, { recursive: true });
  writeFileSync(
    join(main, "package.json"),
    JSON.stringify({ name: "demo", packageManager: "npm@10.9.2" }, null, 2) + "\n",
  );
  writeFileSync(
    join(wt, "package.json"),
    JSON.stringify({ name: "demo", packageManager: "npm@10.9.2" }, null, 2) + "\n",
  );
  const entries = [
    {
      name: "demo",
      path: main,
      storagePath: join(main, ".gitnexus"),
      indexedAt: "2026-05-21T00:00:00.000Z",
      lastCommit: "parent123",
      stats: { files: 1, nodes: 2, edges: 3 },
    },
  ];
  if (options.exactWorktreeIndex !== false) {
    entries.push({
      name: "gxpm-GXPM-90",
      path: wt,
      storagePath: join(wt, ".gitnexus"),
      indexedAt: "2026-05-21T00:00:00.000Z",
      lastCommit: "abc123",
      stats: { files: 4, nodes: 5, edges: 6 },
    });
  }
  writeFileSync(join(home, ".gitnexus", "registry.json"), JSON.stringify(entries, null, 2) + "\n");
  writeExecutable(join(matchingBin, "npm"), `echo "10.9.2"`);
  writeExecutable(
    join(matchingBin, "npx"),
    `if [[ "$*" == "gitnexus status" ]]; then
  echo "Repository: ${main}"
  exit 0
fi
if [[ "$1" == "gitnexus" && "$2" == "analyze" ]]; then
  printf '%s\\n' "$*" > "${npxLogPath}"
  echo "fake gitnexus indexed"
  exit 0
fi
echo "10.9.2"`,
  );
  writeExecutable(join(wrongBin, "npm"), `echo "11.11.0"`);
  writeExecutable(
    join(wrongBin, "npx"),
    `echo "wrong npx used" >&2
exit 235`,
  );
  writeExecutable(
    join(matchingBin, "git"),
    `if [[ "$*" == "rev-parse --show-toplevel" ]]; then
  echo "${wt}"
  exit 0
fi
if [[ "$*" == "rev-parse HEAD" ]]; then
  echo "abc123"
  exit 0
fi
exit 1`,
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${matchingBin}:${previousPath ?? ""}`;
  return {
    main,
    wt,
    matchingBin,
    wrongBin,
    home,
    npxLogPath,
    cleanup() {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeExecutable(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  // Bun on macOS honors POSIX execute bits for spawnSync.
  Bun.spawnSync({ cmd: ["chmod", "+x", path] });
}
