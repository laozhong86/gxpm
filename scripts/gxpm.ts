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

function main(argv: string[]) {
  if (argv.includes("--verbose-events")) {
    argv = argv.filter((arg) => arg !== "--verbose-events");
    getWorkflowEventEmitter().subscribe((event) => {
      console.error(`[event] ${JSON.stringify(event)}`);
    });
  }

  const [command, subcommand, issueId, value] = argv;

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
    runWorkspaceCommand(argv, subcommand, issueId);
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
    runIssueCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "artifact") {
    runArtifactCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "gate") {
    runGateCommand(argv, subcommand, issueId);
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

try {
  main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
