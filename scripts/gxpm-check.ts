import { runScaffoldCheck } from "./scaffold-check";
import { checkCliPromises, formatCheckResult } from "./check-cli-promises";

function main() {
  console.log(runScaffoldCheck());
  const cliResult = checkCliPromises();
  console.log(formatCheckResult(cliResult));
  if (!cliResult.ok) {
    throw new Error("check-cli-promises failed; see output above.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
