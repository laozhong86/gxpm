import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ALL_HOST_CONFIGS } from "../hosts";
import type { HostName } from "../hosts";

export interface HostProbeResult {
  host: HostName;
  displayName: string;
  cliInstalled: boolean;
  repoConfigExists: boolean;
  userConfigExists: boolean;
  /** True if any signal suggests the host is actively used */
  detected: boolean;
}

/**
 * Probe which agent CLIs are installed and active for a given repo.
 *
 * Detection strategy (per host):
 *   1. CLI command in PATH  → cliInstalled
 *   2. <repo>/<hostSubdir> exists  → repoConfigExists
 *   3. ~/<hostSubdir> exists  → userConfigExists
 *
 * A host is "detected" if the CLI is in PATH OR repo config exists.
 * User config alone does not count (user may have installed it globally
 * but not use it for this project).
 */
export function probeHosts(target: string): HostProbeResult[] {
  const home = homedir();

  return ALL_HOST_CONFIGS.map((config) => {
    const cliInstalled = commandExists(config.cliCommand);
    const repoConfigExists = existsSync(join(target, config.hostSubdir));
    const userConfigExists = existsSync(join(home, config.hostSubdir));
    const detected = cliInstalled || repoConfigExists;

    return {
      host: config.name,
      displayName: config.displayName,
      cliInstalled,
      repoConfigExists,
      userConfigExists,
      detected,
    };
  });
}

/** Return only hosts that appear to be installed / active. */
export function detectedHostNames(target: string): HostName[] {
  return probeHosts(target)
    .filter((r) => r.detected)
    .map((r) => r.host);
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
