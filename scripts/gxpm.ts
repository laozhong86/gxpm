import { runCleanupLandCommand } from "./cleanup";
import { formatDoctorReport, runDoctor } from "./doctor";
import { runGlobalDiscover } from "./global-discover";
import { findPhaseArtifactCommand } from "./phase-artifact-commands";
import { runScaffoldCheck } from "./scaffold-check";
import { readGxpmVersion } from "./version";
import { resolveSessionId } from "../core/session";
import { getWorkflowEventEmitter } from "../core/workflow-event-emitter";
import { runArtifactCommand } from "./commands/artifact";
import { runCapabilityCommand } from "./commands/capability";
import { runConfigCommand, runWorktreePolicyCommand } from "./commands/config";
import { runGateCommand } from "./commands/gate";
import { runIssueCommand } from "./commands/issue";
import { runOrchestratorCommand, runRunCommand, runWorkspaceCommand } from "./commands/runtime";
import { runWikiCommand } from "./commands/wiki";
import { runInitCommand } from "./commands/init";
import { runPostUpgradeCommand, runUpgradeCommand } from "./commands/upgrade";
import { runVerifyCommand } from "./commands/verify";
import { runDagCommand } from "./commands/dag";
import { runHookCommand } from "./commands/hook";
import { runWorkflowCommand } from "./commands/workflow";
import { runPresetCommand } from "./commands/preset";
import { runPhaseCommand } from "./commands/phase";
import { runSpecifyCommand } from "./commands/specify";
import { runFeedbackCommand } from "./commands/feedback";
import { getCommandUsage, getTopLevelUsage, isHelpRequest } from "./commands/help";

async function main(argv: string[]) {
  if (argv.includes("--verbose-events")) {
    argv = argv.filter((arg) => arg !== "--verbose-events");
    getWorkflowEventEmitter().subscribe((event) => {
      console.error(`[event] ${JSON.stringify(event)}`);
    });
  }
  // Filter out flags like --army / --help / -h before positional parsing.
  // --help / -h are preserved as a signal but stripped from positional so they
  // don't get treated as commands. Subcommand routers receive the full argv so
  // they can still detect query flags if needed.
  const wantsHelp = isHelpRequest(argv);
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const [command, subcommand, issueId, value] = positional;

  if (wantsHelp && (!command || command === "help")) {
    console.log(getTopLevelUsage());
    return;
  }

  if (wantsHelp && command) {
    console.log(getCommandUsage(command, subcommand));
    return;
  }

  if (command === "help") {
    console.log(getCommandUsage(subcommand));
    return;
  }

  if (!command || command === "check") {
    console.log(runScaffoldCheck());
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(readGxpmVersion());
    return;
  }

  if (command === "session-id") {
    console.log(resolveSessionId());
    return;
  }

  if (command === "config") {
    runConfigCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "worktree") {
    runWorktreePolicyCommand(argv, subcommand);
    return;
  }

  if (command === "capability") {
    runCapabilityCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "wiki") {
    runWikiCommand(argv, subcommand);
    return;
  }

  if (command === "init") {
    runInitCommand(argv.slice(1));
    return;
  }

  if (command === "doctor") {
    const json = argv.includes("--json");
    const fix = argv.includes("--fix");
    const report = runDoctor({ fix });
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    return;
  }

  if (command === "upgrade") {
    runUpgradeCommand(argv.slice(1));
    return;
  }

  if (command === "post-upgrade") {
    runPostUpgradeCommand(argv.slice(1));
    return;
  }

  if (command === "verify") {
    // gxpm verify qa <id> is a phase artifact command; do not shadow it.
    const phaseArtifactCommand = findPhaseArtifactCommand(command, subcommand);
    if (!phaseArtifactCommand) {
      runVerifyCommand(argv.slice(1));
      return;
    }
  }

  if (command === "run") {
    runRunCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "workspace") {
    await runWorkspaceCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "orchestrator") {
    runOrchestratorCommand(argv, subcommand);
    return;
  }

  if (command === "global-discover") {
    const entries = runGlobalDiscover();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      for (const entry of entries) {
        console.log(`${entry.key}\t${entry.repos.join(",")}`);
      }
    }
    return;
  }

  if (command === "issue") {
    await runIssueCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "artifact") {
    runArtifactCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "autopilot") {
    const { runAutopilotCommand } = await import("./commands/autopilot");
    runAutopilotCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "gate") {
    runGateCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "dag") {
    runDagCommand(argv);
    return;
  }

  if (command === "workflow") {
    runWorkflowCommand(argv);
    return;
  }

  if (command === "hook") {
    await runHookCommand(argv);
    return;
  }

  if (command === "preset") {
    runPresetCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "specify" && subcommand !== "init") {
    runSpecifyCommand(argv, subcommand, issueId);
    return;
  }

  if (command === "feedback") {
    await runFeedbackCommand(argv, subcommand);
    return;
  }

  if (command === "phase") {
    runPhaseCommand(argv, subcommand);
    return;
  }

  if (command === "cleanup" && subcommand === "land") {
    if (!issueId) {
      throw new Error("Usage: gxpm cleanup land <issue-id> [--execute] [--force]");
    }
    runCleanupLandCommand(argv, issueId);
    return;
  }

  const phaseArtifactCommand = findPhaseArtifactCommand(command, subcommand);
  if (phaseArtifactCommand) {
    if (!issueId) {
      throw new Error(`Usage: ${phaseArtifactCommand.command}`);
    }
    phaseArtifactCommand.initialize({ issueId });
    console.log(phaseArtifactCommand.successMessage(issueId));
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

main(Bun.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
