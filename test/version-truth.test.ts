// Feature: package.json is the sole version truth (GXPM-173)
//
// Scenarios from .gxpm/issues/GXPM-173/artifacts/behavior-spec.json.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGxpmVersion, validateVersionTruth } from "../scripts/version";

function makeSandbox(pkgVersion: string | undefined, extra?: { writeVersionFile?: string }) {
  const dir = mkdtempSync(join(tmpdir(), "gxpm-173-"));
  const pkg = pkgVersion === undefined
    ? { name: "fixture" }
    : { name: "fixture", version: pkgVersion };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  if (extra?.writeVersionFile !== undefined) {
    writeFileSync(join(dir, "VERSION"), extra.writeVersionFile, "utf8");
  }
  return dir;
}

// scn-01: readGxpmVersion returns package.json.version
describe("scn-01: readGxpmVersion reads package.json", () => {
  let sandbox: string;
  beforeAll(() => { sandbox = makeSandbox("0.2.0"); });
  afterAll(() => { rmSync(sandbox, { recursive: true, force: true }); });

  test("returns the version string from package.json", () => {
    expect(readGxpmVersion({ root: sandbox })).toBe("0.2.0");
  });

  test("does not require a VERSION file", () => {
    expect(() => readGxpmVersion({ root: sandbox })).not.toThrow();
  });
});

// scn-02: validateVersionTruth uses semver pattern
describe("scn-02: validateVersionTruth enforces semver", () => {
  test("accepts plain 3-segment semver", () => {
    const sandbox = makeSandbox("0.2.0");
    expect(validateVersionTruth({ root: sandbox })).toEqual([]);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("accepts prerelease semver", () => {
    const sandbox = makeSandbox("0.2.0-beta.1");
    expect(validateVersionTruth({ root: sandbox })).toEqual([]);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("accepts build-metadata semver", () => {
    const sandbox = makeSandbox("0.2.0+abc.1");
    expect(validateVersionTruth({ root: sandbox })).toEqual([]);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("rejects 4-segment legacy version", () => {
    const sandbox = makeSandbox("0.1.0.0");
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("rejects too-short version", () => {
    const sandbox = makeSandbox("1.4");
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
    rmSync(sandbox, { recursive: true, force: true });
  });

  // CodeRabbit on PR #58: SEMVER_PATTERN must reject leading-zero components.
  test("rejects leading-zero major", () => {
    const sandbox = makeSandbox("01.2.3");
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("rejects leading-zero minor", () => {
    const sandbox = makeSandbox("1.02.3");
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("rejects empty prerelease group", () => {
    const sandbox = makeSandbox("1.2.3-");
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be valid semver/);
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("reports missing package.json.version", () => {
    const sandbox = makeSandbox(undefined);
    const errors = validateVersionTruth({ root: sandbox });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/missing or empty/);
    rmSync(sandbox, { recursive: true, force: true });
  });
});

// scn-03: legacy VERSION file is flagged
describe("scn-03: legacy VERSION file warning", () => {
  test("surfaces an error naming the orphan file when both exist", () => {
    const sandbox = makeSandbox("0.2.0", { writeVersionFile: "0.2.0.0\n" });
    const errors = validateVersionTruth({ root: sandbox });
    const legacyErr = errors.find((e) => e.includes("legacy VERSION file"));
    expect(legacyErr).toBeDefined();
    expect(legacyErr).toMatch(/sole source of truth/);
    rmSync(sandbox, { recursive: true, force: true });
  });
});
