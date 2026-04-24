import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GovernanceCheckOptions {
  root?: string;
}

const REQUIRED_DOCS = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/governance/development-contract.md",
  "docs/governance/template-authoring.md",
  "docs/governance/host-adapter.md",
];

export function validateGovernanceDocs(options: GovernanceCheckOptions = {}): string[] {
  const root = options.root ?? process.cwd();
  const errors: string[] = [];

  for (const doc of REQUIRED_DOCS) {
    if (!existsSync(join(root, doc))) {
      errors.push(`missing governance doc: ${doc}`);
    }
  }

  if (errors.length > 0) {
    return errors;
  }

  const agents = readText(root, "AGENTS.md");
  const claude = readText(root, "CLAUDE.md");

  if (lineCount(agents) > 150) {
    errors.push("AGENTS.md should stay under 150 lines");
  }

  if (lineCount(claude) > 80) {
    errors.push("CLAUDE.md should stay a thin bootstrap under 80 lines");
  }

  for (const heading of ["## Always", "## Ask First", "## Never"]) {
    if (!agents.includes(heading)) {
      errors.push(`AGENTS.md missing boundary heading: ${heading}`);
    }
  }

  if (!claude.includes("AGENTS.md")) {
    errors.push("CLAUDE.md must point back to AGENTS.md");
  }

  return errors;
}

function readText(root: string, path: string) {
  return readFileSync(join(root, path), "utf8");
}

function lineCount(content: string) {
  return content.trimEnd().split("\n").length;
}

if (import.meta.main) {
  const errors = validateGovernanceDocs();
  if (errors.length > 0) {
    console.error(errors.map((error) => `governance: ${error}`).join("\n"));
    process.exit(1);
  }
  console.log("governance docs check passed");
}
