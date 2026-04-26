import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateVersionTruth } from "../scripts/version";
import { output, runScript } from "./helpers/workflow";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = resolve(repoRoot, "scripts", "gxpm.ts");
const expectedVersion = readFileSync(resolve(repoRoot, "VERSION"), "utf8").trim();

describe("gxpm version CLI", () => {
  test("'gxpm version' prints the VERSION file", () => {
    const r = runScript([cliPath, "version"]);
    expect(r.exitCode).toBe(0);
    expect(output(r).trim()).toBe(expectedVersion);
  });

  test("package.json version matches VERSION", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(expectedVersion);
  });

  test("version truth validation catches VERSION/package drift", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-version-drift-"));
    writeFileSync(join(root, "VERSION"), "0.1.0.0\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.1.0" }));

    expect(validateVersionTruth({ root })).toEqual([
      "package.json version (0.1.1.0) must match VERSION (0.1.0.0)",
    ]);
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
