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
import { initializeAcceptanceCheck } from "../core/ac-check";
import { listArtifacts, readArtifact } from "../core/artifacts";
import { initializeDispatch } from "../core/dispatch";
import { initializeLocalVerify } from "../core/implement";
import { initializePlan } from "../core/plan";
import { initializePrCheck } from "../core/pr-check";
import { initializeSelfReview } from "../core/self-review";
import { initializeShipReadiness } from "../core/ship";
import { initializeTriage } from "../core/triage";
import { initializeVerifyFindings } from "../core/verify";

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

  if (command === "dispatch" && subcommand === "init") {
    if (!issueId) {
      throw new Error("Usage: gxpm dispatch init <issue-id>");
    }
    initializeDispatch({ issueId });
    console.log(`initialized dispatch handoff for ${issueId}`);
    return;
  }

  if (command === "implement" && subcommand === "verify") {
    if (!issueId) {
      throw new Error("Usage: gxpm implement verify <issue-id>");
    }
    initializeLocalVerify({ issueId });
    console.log(`initialized local verify artifact for ${issueId}`);
    return;
  }

  if (command === "local-verify" && subcommand === "ac-check") {
    if (!issueId) {
      throw new Error("Usage: gxpm local-verify ac-check <issue-id>");
    }
    initializeAcceptanceCheck({ issueId });
    console.log(`initialized acceptance check artifact for ${issueId}`);
    return;
  }

  if (command === "ac-check" && subcommand === "self-review") {
    if (!issueId) {
      throw new Error("Usage: gxpm ac-check self-review <issue-id>");
    }
    initializeSelfReview({ issueId });
    console.log(`initialized self review artifact for ${issueId}`);
    return;
  }

  if (command === "self-review" && subcommand === "ship") {
    if (!issueId) {
      throw new Error("Usage: gxpm self-review ship <issue-id>");
    }
    initializeShipReadiness({ issueId });
    console.log(`initialized ship readiness artifact for ${issueId}`);
    return;
  }

  if (command === "ship" && subcommand === "pr-check") {
    if (!issueId) {
      throw new Error("Usage: gxpm ship pr-check <issue-id>");
    }
    initializePrCheck({ issueId });
    console.log(`initialized pr check artifact for ${issueId}`);
    return;
  }

  if (command === "pr-check" && subcommand === "verify") {
    if (!issueId) {
      throw new Error("Usage: gxpm pr-check verify <issue-id>");
    }
    initializeVerifyFindings({ issueId });
    console.log(`initialized verify findings artifact for ${issueId}`);
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
