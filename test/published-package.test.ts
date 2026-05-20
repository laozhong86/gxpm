// Feature: Published gxpm package boots without typescript at runtime
//
// As a user installing @geminix/gxpm globally via bun/npm
// I want every gxpm subcommand to run without requiring typescript as a
//   runtime dependency
// So that the global CLI works out of the box, and only wiki-native — the
//   single feature that needs typescript for symbol extraction — degrades
//   gracefully when typescript is missing.

import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("published @geminix/gxpm — runtime boot without typescript", () => {
  // Scenario (scn-01): the packed tarball boots core subcommands even when
  // typescript is not installed in the consuming node_modules.
  test(
    "scn-01: packed tarball runs gxpm subcommand without typescript installed",
    () => {
      // 1) Pack the local source into a tarball.
      const pack = spawnSync("npm", ["pack", "--silent", "--pack-destination", REPO_ROOT], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: { ...process.env, npm_config_loglevel: "error" },
      });
      if (pack.status !== 0) {
        throw new Error(
          `npm pack failed (${pack.status}):\nSTDOUT:\n${pack.stdout}\nSTDERR:\n${pack.stderr}`,
        );
      }
      const tarballName = (pack.stdout || "").trim().split("\n").pop()!;
      const tarballPath = join(REPO_ROOT, tarballName);
      expect(existsSync(tarballPath)).toBe(true);

      // 2) Install the tarball into a clean temp dir whose node_modules has no typescript.
      const installDir = mkdtempSync(join(tmpdir(), "gxpm-pack-install-"));
      try {
        writeFileSync(
          join(installDir, "package.json"),
          JSON.stringify({ name: "gxpm-pack-smoke", private: true }),
        );
        // --ignore-scripts: don't run lifecycle hooks (security + predictability).
        // --prefer-offline: use cached deps when possible so this test is less
        // flaky in restricted-network CI. Online runs fall back to registry as
        // usual. CodeRabbit P2 on PR #55.
        const install = spawnSync(
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--prefer-offline",
            "--no-fund",
            "--no-audit",
            "--silent",
            tarballPath,
          ],
          { cwd: installDir, encoding: "utf-8", env: { ...process.env, npm_config_loglevel: "error" } },
        );
        if (install.status !== 0) {
          throw new Error(
            `npm install failed (${install.status}):\nSTDOUT:\n${install.stdout}\nSTDERR:\n${install.stderr}`,
          );
        }
        // Sanity: typescript MUST NOT be in the install — that's the whole point.
        expect(existsSync(join(installDir, "node_modules", "typescript"))).toBe(false);

        // 3) Run a core subcommand from the installed CLI.
        const gxpmBin = join(installDir, "node_modules", ".bin", "gxpm");
        expect(existsSync(gxpmBin)).toBe(true);

        // Use a temp GXPM_ROOT so the subcommand has somewhere safe to look.
        const gxpmRoot = mkdtempSync(join(tmpdir(), "gxpm-pack-root-"));
        try {
          mkdirSync(join(gxpmRoot, ".gxpm"), { recursive: true });
          const run = spawnSync(gxpmBin, ["issue", "list"], {
            cwd: gxpmRoot,
            encoding: "utf-8",
            env: { ...process.env, GXPM_ROOT: gxpmRoot },
          });
          expect(run.stderr).not.toContain("Cannot find package 'typescript'");
          expect(run.stderr).not.toContain('Cannot find package "typescript"');
          expect(run.status).toBe(0);
        } finally {
          rmSync(gxpmRoot, { recursive: true, force: true });
        }
      } finally {
        rmSync(installDir, { recursive: true, force: true });
        try {
          rmSync(tarballPath, { force: true });
        } catch {
          // best-effort cleanup
        }
      }
    },
    { timeout: 120_000 },
  );

  // Scenario (scn-02): extractNativeSymbols (or the wiki-native module as a
  // whole) does not throw when typescript is unavailable; it gracefully
  // returns an empty symbol list so downstream summarizeNativeFile keeps working.
  test("scn-02: wiki-native symbol extraction degrades gracefully without typescript", async () => {
    // The contract is observed at the module level: importing wiki-native must
    // succeed even if `typescript` is not resolvable. We exercise that by reading
    // the module's source and verifying it does NOT contain a top-level
    // `import ... from "typescript"` (which would fail at load time when ts is missing).
    const src = readFileSync(join(REPO_ROOT, "core/wiki-native.ts"), "utf-8");
    const topLevelTsImport = src.match(
      /^[ \t]*import\s+[^;]*\s+from\s+["']typescript["'];?$/m,
    );
    expect(
      topLevelTsImport,
      `wiki-native.ts still has a top-level "import ... from \"typescript\"" — global installs without typescript will crash on module load.`,
    ).toBeNull();
  });
});
