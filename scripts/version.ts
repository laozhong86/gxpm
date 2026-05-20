import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

// GXPM-173: 3-segment semver with optional prerelease/build metadata, matching
// what npm publish accepts. Examples that pass: 0.2.0, 1.4.7, 0.2.0-beta.1,
// 0.2.0+meta. Examples that fail: 0.1.0.0 (legacy 4-segment), 1.4 (too short).
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface PackageJsonShape {
  version?: string;
}

function readPackageJsonVersion(root: string): string {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const raw = readFileSync(pkgPath, "utf8");
  let parsed: PackageJsonShape;
  try {
    parsed = JSON.parse(raw) as PackageJsonShape;
  } catch (err) {
    throw new Error(`package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const version = parsed.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json.version is missing or empty");
  }
  return version;
}

export function readGxpmVersion(input: { root?: string } = {}): string {
  const root = input.root ?? DEFAULT_GXPM_ROOT;
  return readPackageJsonVersion(root);
}

export function validateVersionTruth(input: { root?: string } = {}): string[] {
  const root = input.root ?? DEFAULT_GXPM_ROOT;
  const errors: string[] = [];

  let version = "";
  try {
    version = readPackageJsonVersion(root);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return errors;
  }

  if (!SEMVER_PATTERN.test(version)) {
    errors.push(
      `package.json.version (${version}) must be valid semver — 3-segment X.Y.Z with optional -prerelease/+build`,
    );
  }

  // GXPM-173: surface a migration warning if the legacy VERSION file is still
  // present. Non-fatal so checkouts mid-migration don't break, but visible so
  // the file gets cleaned up in this PR or shortly after.
  const legacyVersionPath = join(root, "VERSION");
  if (existsSync(legacyVersionPath)) {
    errors.push(
      `legacy VERSION file at ${legacyVersionPath} should be removed; package.json.version is the sole source of truth`,
    );
  }

  return errors;
}
