import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { output, runScript } from "./helpers/workflow";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = resolve(repoRoot, "scripts", "gxpm.ts");
const expectedVersion = (
  JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("gxpm version CLI", () => {
  test("'gxpm version' prints semver from package.json", () => {
    const r = runScript([cliPath, "version"]);
    expect(r.exitCode).toBe(0);
    expect(output(r).trim()).toBe(expectedVersion);
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
