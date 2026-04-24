import { ALL_HOST_CONFIGS } from "../hosts";
import { generateSkillDocs } from "./gen-skill-docs";
import { validateGovernanceDocs } from "./governance-check";
import { validateAllConfigs } from "./host-config";
import {
  createIssueState,
  getIssuePaths,
  readIssueState,
  transitionIssuePhase,
} from "../core/state";

function runCheck() {
  const hostErrors = validateAllConfigs(ALL_HOST_CONFIGS);
  const governanceErrors = validateGovernanceDocs();
  const errors = [
    ...hostErrors.map((error) => `host config: ${error}`),
    ...governanceErrors.map((error) => `governance: ${error}`),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  generateSkillDocs({ dryRun: true });
  console.log(`gxpm scaffold check passed (${ALL_HOST_CONFIGS.length} hosts)`);
}

function main(argv: string[]) {
  const [command, subcommand, issueId, phase] = argv;

  if (!command || command === "check") {
    runCheck();
    return;
  }

  if (command !== "issue") {
    throw new Error(`Unknown command: ${command}`);
  }

  if (subcommand === "create") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue create <issue-id>");
    }
    const state = createIssueState({ issueId });
    console.log(`created ${state.issueId} at ${state.currentPhase}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
    return;
  }

  if (subcommand === "status") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue status <issue-id>");
    }
    const state = readIssueState({ issueId });
    console.log(`issueId: ${state.issueId}`);
    console.log(`currentPhase: ${state.currentPhase}`);
    console.log(`updatedAt: ${state.updatedAt}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
    return;
  }

  if (subcommand === "transition") {
    if (!issueId || !phase) {
      throw new Error("Usage: gxpm issue transition <issue-id> <phase>");
    }
    const before = readIssueState({ issueId });
    const after = transitionIssuePhase({ issueId, nextPhase: phase });
    console.log(`transitioned ${after.issueId}: ${before.currentPhase} -> ${after.currentPhase}`);
    return;
  }

  throw new Error(`Unknown issue command: ${subcommand ?? "<missing>"}`);
}

try {
  main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
