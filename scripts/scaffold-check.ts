import { resolve } from "node:path";
import { ALL_HOST_CONFIGS } from "../hosts";
import { generateSkillDocs } from "./gen-skill-docs";
import { validateGovernanceDocs } from "./governance-check";
import { validateAllConfigs } from "./host-config";
import { validateVersionTruth } from "./version";

// Default to the gxpm repo itself (parent of scripts/) so the check is
// meaningful regardless of the cwd the CLI was invoked from.
const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

export interface RunScaffoldCheckOptions {
  root?: string;
}

export function runScaffoldCheck(options: RunScaffoldCheckOptions = {}) {
  const root = options.root ?? DEFAULT_GXPM_ROOT;

  const hostErrors = validateAllConfigs(ALL_HOST_CONFIGS);
  const governanceErrors = validateGovernanceDocs({ root });
  const versionErrors = validateVersionTruth({ root });
  const errors = [
    ...hostErrors.map((error) => `host config: ${error}`),
    ...governanceErrors.map((error) => `governance: ${error}`),
    ...versionErrors.map((error) => `version: ${error}`),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  generateSkillDocs({ root, dryRun: true });
  return `gxpm scaffold check passed (${ALL_HOST_CONFIGS.length} hosts)`;
}
