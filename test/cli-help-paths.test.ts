import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function runGxpm(args: string[]) {
  const result = spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, GXPM_TEST: "1" },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("GXPM-139 / scn-01: gxpm <subcmd> --help prints Usage (not 'Unknown command')", () => {
  const subcommands = ["artifact", "issue", "verify", "gate", "wiki", "autopilot", "feedback", "phase", "specify"];

  for (const sub of subcommands) {
    test(`gxpm ${sub} --help → Usage`, () => {
      const { code, stdout, stderr } = runGxpm([sub, "--help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stderr).not.toContain("Unknown command");
    });
  }

  test("gxpm --help → top-level Usage", () => {
    const { code, stdout } = runGxpm(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: gxpm <command>");
  });

  test("gxpm help artifact → artifact Usage", () => {
    const { code, stdout } = runGxpm(["help", "artifact"]);
    expect(code).toBe(0);
    expect(stdout).toContain("gxpm artifact write");
  });
});
