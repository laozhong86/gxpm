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
import { listArtifacts, readArtifact } from "../core/artifacts";
import { initializePlan } from "../core/plan";
import { initializeTriage } from "../core/triage";

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
  const [command, subcommand, issueId, value] = argv;

  if (!command || command === "check") {
    runCheck();
    return;
  }

  if (command === "issue" && subcommand === "create") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue create <issue-id>");
    }
    const state = createIssueState({ issueId });
    console.log(`created ${state.issueId} at ${state.currentPhase}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
    return;
  }

  if (command === "issue" && subcommand === "status") {
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

  if (command === "issue" && subcommand === "transition") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm issue transition <issue-id> <phase>");
    }
    const before = readIssueState({ issueId });
    const after = transitionIssuePhase({ issueId, nextPhase: value });
    console.log(`transitioned ${after.issueId}: ${before.currentPhase} -> ${after.currentPhase}`);
    return;
  }

  if (command === "artifact" && subcommand === "list") {
    if (!issueId) {
      throw new Error("Usage: gxpm artifact list <issue-id>");
    }
    const artifacts = listArtifacts({ issueId });
    if (artifacts.length === 0) {
      console.log("no artifacts");
      return;
    }
    for (const artifact of artifacts) {
      console.log(`${artifact.type}\t${artifact.path}\t${artifact.writtenAt}`);
    }
    return;
  }

  if (command === "artifact" && subcommand === "read") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm artifact read <issue-id> <type>");
    }
    console.log(JSON.stringify(readArtifact({ issueId, type: value }), null, 2));
    return;
  }

  if (command === "triage" && subcommand === "init") {
    if (!issueId) {
      throw new Error("Usage: gxpm triage init <issue-id>");
    }
    initializeTriage({ issueId });
    console.log(`initialized triage artifacts for ${issueId}`);
    return;
  }

  if (command === "plan" && subcommand === "init") {
    if (!issueId) {
      throw new Error("Usage: gxpm plan init <issue-id>");
    }
    initializePlan({ issueId });
    console.log(`initialized plan artifact for ${issueId}`);
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

try {
  main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
