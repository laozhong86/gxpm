import { ALL_HOST_CONFIGS } from "../hosts";
import { validateAllConfigs } from "./host-config";
import { generateSkillDocs } from "./gen-skill-docs";
import { validateGovernanceDocs } from "./governance-check";

function main() {
  const errors = validateAllConfigs(ALL_HOST_CONFIGS);
  if (errors.length > 0) {
    console.error(errors.map((error) => `host config: ${error}`).join("\n"));
    process.exit(1);
  }

  const governanceErrors = validateGovernanceDocs();
  if (governanceErrors.length > 0) {
    console.error(governanceErrors.map((error) => `governance: ${error}`).join("\n"));
    process.exit(1);
  }

  generateSkillDocs({ dryRun: true });
  console.log(`gxpm scaffold check passed (${ALL_HOST_CONFIGS.length} hosts)`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
