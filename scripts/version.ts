import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

export function readGxpmVersion(input: { root?: string } = {}): string {
  const root = input.root ?? DEFAULT_GXPM_ROOT;
  const versionPath = join(root, "VERSION");
  if (!existsSync(versionPath)) {
    throw new Error(`VERSION file not found: ${versionPath}`);
  }
  const version = readFileSync(versionPath, "utf8").trim();
  if (!version) {
    throw new Error("VERSION file is empty");
  }
  return version;
}

export function validateVersionTruth(input: { root?: string } = {}): string[] {
  const root = input.root ?? DEFAULT_GXPM_ROOT;
  const errors: string[] = [];
  let version = "";

  try {
    version = readGxpmVersion({ root });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (version && !VERSION_PATTERN.test(version)) {
    errors.push(`VERSION must use four-segment numeric format, got: ${version}`);
  }

  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    if (version && pkg.version !== version) {
      errors.push(`package.json version (${pkg.version ?? "<missing>"}) must match VERSION (${version})`);
    }
  } catch (error) {
    errors.push(`package.json version check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return errors;
}
