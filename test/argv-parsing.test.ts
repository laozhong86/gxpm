import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function runGxpm(args: string[]) {
  const result = spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("GXPM-139 / scn-04: argv parsing preserves --help for routers", () => {
  test("--help passes through to artifact router and prints Usage", () => {
    const { code, stdout, stderr } = runGxpm(["artifact", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("gxpm artifact write");
    expect(stderr).not.toContain("Unknown command");
  });

  test("--verbose-events is filtered but command still routes", () => {
    // We can't easily verify event subscription here; just assert the command
    // is recognized rather than rejected as Unknown when --verbose-events appears
    // alongside a subcommand that would otherwise fail validation (write needs args).
    const { stderr } = runGxpm(["--verbose-events", "artifact", "write"]);
    // Should NOT be "Unknown command"; should be a Usage error from artifact write
    expect(stderr).not.toContain("Unknown command");
  });
});
