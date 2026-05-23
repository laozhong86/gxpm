import {
  formatGitNexusWorktreeStatus,
  getGitNexusWorktreeStatus,
  gitNexusStatusExitCode,
  runGitNexusAnalyze,
} from "../../core/gitnexus-worktree";
import {
  defaultRegistryPath,
  pruneDanglingRegistryEntries,
  RegistryMissingError,
  RegistryReadError,
  type DroppedEntry,
  type PruneOutcome,
} from "../../core/gitnexus-registry";

export function runGitNexusCommand(argv: string[], subcommand: string | undefined) {
  if (!subcommand || subcommand === "status") {
    const status = getGitNexusWorktreeStatus();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      const output = formatGitNexusWorktreeStatus(status);
      if (status.ok) {
        process.stdout.write(output);
      } else {
        process.stderr.write(output);
      }
    }
    process.exitCode = gitNexusStatusExitCode(status);
    return;
  }

  if (subcommand === "index" || subcommand === "analyze") {
    const result = runGitNexusAnalyze({
      force: argv.includes("--force"),
      noStats: argv.includes("--no-stats"),
    });
    process.stdout.write(result.stdout.toString());
    process.stderr.write(result.stderr.toString());
    process.exitCode = result.exitCode ?? 1;
    return;
  }

  if (subcommand === "prune") {
    runGitNexusPrune(argv);
    return;
  }

  throw new Error(
    "Usage: gxpm gitnexus status [--json] | gxpm gitnexus index [--force] [--no-stats] | gxpm gitnexus prune [--execute] [--json]",
  );
}

function runGitNexusPrune(argv: string[]): void {
  const execute = argv.includes("--execute");
  const wantJson = argv.includes("--json");
  let outcome: PruneOutcome;
  try {
    outcome = pruneDanglingRegistryEntries({ execute });
  } catch (err) {
    if (err instanceof RegistryMissingError) {
      process.stderr.write(`gxpm gitnexus prune: GitNexus registry not found: ${err.registryPath}\n`);
      process.exitCode = 1;
      return;
    }
    if (err instanceof RegistryReadError) {
      process.stderr.write(`gxpm gitnexus prune: ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gxpm gitnexus prune: ${detail}\n`);
    process.exitCode = 1;
    return;
  }

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          registryPath: outcome.registryPath,
          total: outcome.total,
          kept: outcome.kept.length,
          dropped: outcome.dropped.map((d) => ({
            path: d.entry.path,
            name: d.entry.name,
            reason: d.reason,
            detail: d.detail,
          })),
          executed: execute && outcome.dropped.length > 0,
        },
        null,
        2,
      ),
    );
    process.exitCode = 0;
    return;
  }

  process.stdout.write(`registry: ${outcome.registryPath}\n`);
  process.stdout.write(`total: ${outcome.total}\n`);
  process.stdout.write(`kept: ${outcome.kept.length}\n`);
  process.stdout.write(`dropped: ${outcome.dropped.length}\n`);
  if (outcome.dropped.length > 0) {
    process.stdout.write("\ndropped entries:\n");
    for (const d of outcome.dropped) {
      process.stdout.write(formatDropped(d));
    }
  }
  if (!execute) {
    process.stdout.write("\n(dry-run; pass --execute to write)\n");
  } else if (outcome.dropped.length === 0) {
    process.stdout.write("\nnothing to prune\n");
  } else {
    process.stdout.write(`\nwrote ${outcome.kept.length} entries to ${outcome.registryPath}\n`);
  }
  process.exitCode = 0;
}

function formatDropped(d: DroppedEntry): string {
  const name = d.entry.name ?? "(unnamed)";
  const path = d.entry.path ?? "(no path)";
  const detail = d.detail ? ` (${d.detail})` : "";
  return `  - ${name} :: ${path}\n      reason: ${d.reason}${detail}\n`;
}

export { defaultRegistryPath };
