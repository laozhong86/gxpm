import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateVersionTruth } from "../scripts/version";
import { output, runScript } from "./helpers/workflow";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = resolve(repoRoot, "scripts", "gxpm.ts");
// GXPM-173: package.json.version is the single source of truth; the legacy
// VERSION file was removed in 0.2.0.
const expectedVersion = (
  JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as { version: string }
).version;

describe("gxpm version CLI", () => {
  test("'gxpm version' prints package.json.version", () => {
    const r = runScript([cliPath, "version"]);
    expect(r.exitCode).toBe(0);
    expect(output(r).trim()).toBe(expectedVersion);
  });

  test("validateVersionTruth passes on the live repo", () => {
    expect(validateVersionTruth({ root: repoRoot })).toEqual([]);
  });

  test("validateVersionTruth rejects 4-segment legacy versions", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-version-drift-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.1.0" }));
    const errors = validateVersionTruth({ root });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
  });

  test("'gxpm --version' is an alias for 'gxpm version'", () => {
    const r = runScript([cliPath, "--version"]);
    expect(r.exitCode).toBe(0);
    expect(output(r).trim()).toBe(expectedVersion);
  });

  test("'gxpm -v' is also an alias", () => {
    const r = runScript([cliPath, "-v"]);
    expect(r.exitCode).toBe(0);
    expect(output(r).trim()).toBe(expectedVersion);
  });
});
