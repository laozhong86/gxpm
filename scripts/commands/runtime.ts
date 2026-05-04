import { appendRunEvent, deleteRun, listRuns, readRun, RUN_STATUSES, startRun } from "../../core/runs";
import { cleanupIssueWorkspace, ensureIssueWorkspace, planIssueWorkspace } from "../../core/workspace-runtime";
import { dryRunOrchestratorTick } from "../../core/orchestrator";
import { claimIssue } from "../../core/issue-readiness";
import { optionValue, parsePositiveIntegerOption } from "./helpers";

export function runRunCommand(
  argv: string[],
  subcommand: string | undefined,
  issueId: string | undefined,
  runId: string | undefined,
) {
  if (!issueId) {
    throw new Error("Usage: gxpm run start|list|status|event <issue-id> ...");
  }

  if (subcommand === "start") {
    const status = optionValue(argv, "--status") ?? undefined;
    if (status && !RUN_STATUSES.includes(status as (typeof RUN_STATUSES)[number])) {
      throw new Error(`Invalid run status: ${status}`);
    }
    const attempt = parsePositiveIntegerOption(argv, "--attempt");
    const workspacePath = optionValue(argv, "--workspace") ?? undefined;
    const message = optionValue(argv, "--message") ?? undefined;
    const shouldClaim = argv.includes("--claim");
    let run = startRun({
      issueId,
      attempt,
      status,
      workspacePath,
      message,
    });
    const claim = shouldClaim
      ? claimRunOrRollback({
          issueId,
          runId: run.runId,
          actor: optionValue(argv, "--actor") ?? undefined,
        })
      : null;
    if (claim) {
      run = appendRunEvent({
        issueId,
        runId: run.runId,
        type: "run.claimed",
        status: run.status,
        payload: {
          actor: claim.claim.actor,
          claimedBySession: claim.claim.claimedBySession,
          workspacePath: run.workspacePath,
        },
      });
    }
    if (argv.includes("--json")) {
      console.log(JSON.stringify(claim ? { run, claim } : run, null, 2));
    } else {
      console.log(`started ${run.runId} for ${issueId}`);
      console.log(`status: ${run.status}`);
      if (claim) console.log("claim: claimed");
    }
    return;
  }

  if (subcommand === "list") {
    const runs = listRuns({ issueId });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }
    if (runs.length === 0) {
      console.log("no runs");
      return;
    }
    for (const run of runs) {
      console.log(`${run.runId}\t${run.status}\tattempt=${run.attempt}\tupdated=${run.updatedAt}`);
    }
    return;
  }

  if (subcommand === "status") {
    if (!runId) {
      throw new Error("Usage: gxpm run status <issue-id> <run-id> [--json]");
    }
    const run = readRun({ issueId, runId });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      console.log(`runId: ${run.runId}`);
      console.log(`issueId: ${run.issueId}`);
      console.log(`status: ${run.status}`);
      console.log(`attempt: ${run.attempt}`);
      console.log(`sessionId: ${run.sessionId}`);
      if (run.workspacePath) console.log(`workspacePath: ${run.workspacePath}`);
      if (run.failureReason) console.log(`failureReason: ${run.failureReason}`);
    }
    return;
  }

  if (subcommand === "event") {
    if (!runId) {
      throw new Error("Usage: gxpm run event <issue-id> <run-id> --type <event> [--status <status>] [--message <text>] [--reason <text>]");
    }
    const eventType = optionValue(argv, "--type");
    if (!eventType) {
      throw new Error("gxpm run event requires --type <event>");
    }
    const run = appendRunEvent({
      issueId,
      runId,
      type: eventType,
      status: optionValue(argv, "--status") ?? undefined,
      message: optionValue(argv, "--message") ?? undefined,
      failureReason: optionValue(argv, "--reason") ?? undefined,
    });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      console.log(`updated ${run.runId} for ${issueId}`);
      console.log(`status: ${run.status}`);
    }
    return;
  }

  throw new Error(`Usage: gxpm run start <issue-id> [--attempt N] [--status ${RUN_STATUSES.join("|")}] [--workspace <path>] [--claim] [--actor <name>] [--json]
       gxpm run list <issue-id> [--json]
       gxpm run status <issue-id> <run-id> [--json]
       gxpm run event <issue-id> <run-id> --type <event> [--status <status>] [--message <text>] [--reason <text>]`);
}

function claimRunOrRollback(input: { issueId: string; runId: string; actor?: string }) {
  try {
    const claim = claimIssue({
      issueId: input.issueId,
      actor: input.actor,
      runId: input.runId,
    });
    if (!claim.claimed) {
      deleteRun({ issueId: input.issueId, runId: input.runId });
      throw new Error(`Issue already claimed: ${input.issueId}; no run started`);
    }
    return claim;
  } catch (error) {
    deleteRun({ issueId: input.issueId, runId: input.runId });
    throw error;
  }
}

export function runWorkspaceCommand(argv: string[], subcommand: string | undefined, issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm workspace plan|ensure|cleanup <issue-id> [--root <path>] [--json]");
  }
  const workspaceRoot = optionValue(argv, "--root") ?? undefined;
  const result =
    subcommand === "plan"
      ? planIssueWorkspace({ issueId, workspaceRoot })
      : subcommand === "ensure"
        ? ensureIssueWorkspace({ issueId, workspaceRoot })
        : subcommand === "cleanup"
          ? cleanupIssueWorkspace({ issueId, workspaceRoot })
          : null;

  if (!result) {
    throw new Error("Usage: gxpm workspace plan|ensure|cleanup <issue-id> [--root <path>] [--json]");
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`issueId: ${result.issueId}`);
  console.log(`workspaceRoot: ${result.workspaceRoot}`);
  console.log(`workspacePath: ${result.workspacePath}`);
  console.log(`exists: ${result.exists}`);
  if ("devPort" in result) console.log(`devPort: ${result.devPort}`);
  if ("created" in result) console.log(`created: ${result.created}`);
  if ("removed" in result) console.log(`removed: ${result.removed}`);
}

export function runOrchestratorCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand !== "tick" || !argv.includes("--dry-run")) {
    throw new Error("Usage: gxpm orchestrator tick --dry-run [--json] [--include-all]");
  }
  const report = dryRunOrchestratorTick({ includeAll: argv.includes("--include-all") });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`gxpm orchestrator dry-run ${report.generatedAt}`);
  console.log(
    `dispatchable=${report.summary.dispatchable} blocked=${report.summary.blocked} ignored=${report.summary.ignored}`,
  );
  if (report.issues.length === 0) {
    console.log("no candidate issues");
    return;
  }
  for (const issue of report.issues) {
    console.log(`${issue.issueId}\t${issue.currentPhase}\t${issue.decision}\t${issue.reason}`);
  }
}
