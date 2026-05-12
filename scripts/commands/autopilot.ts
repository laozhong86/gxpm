import { createIssueState } from "../../core/state";
import { getNextAvailableIssueId } from "../../core/issues";
import {
  assertAutopilotProfile,
  formatAutopilotGrantContext,
  listActiveAutopilotGrants,
  readAutopilotGrant,
  startAutopilotGrant,
  stopAutopilotGrant,
  type AutopilotGrant,
  type AutopilotProfile,
} from "../../core/autopilot";
import { optionRequiredValue, optionValue, parsePositiveIntegerOption } from "./helpers";

const USAGE = [
  "Usage:",
  "  gxpm autopilot start <issue-id>|--auto-id [--profile full-delivery] [--prompt <text>] [--ttl-minutes N] [--json]",
  "  gxpm autopilot status <issue-id> [--json]",
  "  gxpm autopilot list [--json]",
  "  gxpm autopilot stop <issue-id> [--reason <text>] [--json]",
].join("\n");

export function runAutopilotCommand(argv: string[], subcommand: string | undefined, issueId: string | undefined) {
  if (subcommand === "start") {
    runAutopilotStart(argv, issueId);
    return;
  }

  if (subcommand === "status") {
    runAutopilotStatus(argv, issueId);
    return;
  }

  if (subcommand === "list") {
    runAutopilotList(argv);
    return;
  }

  if (subcommand === "stop") {
    runAutopilotStop(argv, issueId);
    return;
  }

  throw new Error(USAGE);
}

function runAutopilotStart(argv: string[], issueId: string | undefined) {
  const json = argv.includes("--json");
  const autoId = argv.includes("--auto-id");
  if (autoId && issueId && !issueId.startsWith("-")) {
    throw new Error("Usage: choose either `gxpm autopilot start <issue-id>` or `gxpm autopilot start --auto-id`");
  }
  const targetIssueId = autoId ? getNextAvailableIssueId() : issueId;
  if (!targetIssueId || targetIssueId.startsWith("-")) {
    throw new Error(USAGE);
  }

  const profile = parseProfile(argv);
  const ttlMinutes = parsePositiveIntegerOption(argv, "--ttl-minutes");
  const prompt = optionValue(argv, "--prompt") ?? undefined;
  let createdIssue = false;
  if (autoId) {
    createIssueState({ issueId: targetIssueId });
    createdIssue = true;
  }

  const grant = startAutopilotGrant({
    issueId: targetIssueId,
    profile,
    prompt,
    ttlMinutes,
  });

  if (json) {
    console.log(JSON.stringify({ issueId: targetIssueId, createdIssue, grant }, null, 2));
    return;
  }

  console.log(`autopilot grant active for ${targetIssueId}`);
  if (createdIssue) console.log("createdIssue: true");
  printGrantSummary(grant);
  console.log("");
  console.log(`Next: gxpm issue status ${targetIssueId} && gxpm issue next ${targetIssueId}`);
}

function runAutopilotStatus(argv: string[], issueId: string | undefined) {
  if (!issueId || issueId.startsWith("-")) {
    throw new Error(USAGE);
  }
  const grant = readAutopilotGrant({ issueId });
  if (!grant) {
    throw new Error(`Autopilot grant not found for ${issueId}`);
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify(grant, null, 2));
    return;
  }
  printGrantSummary(grant);
}

function runAutopilotList(argv: string[]) {
  const active = listActiveAutopilotGrants();
  if (argv.includes("--json")) {
    console.log(JSON.stringify(active, null, 2));
    return;
  }
  if (active.length === 0) {
    console.log("no active autopilot grants");
    return;
  }
  console.log(formatAutopilotGrantContext(active));
}

function runAutopilotStop(argv: string[], issueId: string | undefined) {
  if (!issueId || issueId.startsWith("-")) {
    throw new Error(USAGE);
  }
  const reason = argv.includes("--reason") ? optionRequiredValue(argv, "--reason") : undefined;
  const grant = stopAutopilotGrant({ issueId, reason });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(grant, null, 2));
    return;
  }
  console.log(`autopilot grant stopped for ${issueId}`);
  printGrantSummary(grant);
}

function parseProfile(argv: string[]): AutopilotProfile {
  const raw = optionValue(argv, "--profile") ?? "full-delivery";
  assertAutopilotProfile(raw);
  return raw;
}

function printGrantSummary(grant: AutopilotGrant) {
  console.log(`profile: ${grant.profile}`);
  console.log(`status: ${grant.status}`);
  console.log(`runId: ${grant.runId}`);
  console.log(`startedAt: ${grant.startedAt}`);
  if (grant.expiresAt) console.log(`expiresAt: ${grant.expiresAt}`);
  if (grant.stopReason) console.log(`stopReason: ${grant.stopReason}`);
  console.log(`allowedActions: ${grant.allowedActions.join(", ")}`);
  console.log(`hardStops: ${grant.hardStops.join(", ")}`);
}
