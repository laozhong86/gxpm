import { runScaffoldCheck } from "./scaffold-check";

function main() {
  console.log(runScaffoldCheck());
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
