import {
  formatGitNexusWorktreeStatus,
  getGitNexusWorktreeStatus,
  gitNexusStatusExitCode,
  runGitNexusAnalyze,
} from "../../core/gitnexus-worktree";

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

  throw new Error("Usage: gxpm gitnexus status [--json] | gxpm gitnexus index [--force] [--no-stats]");
}
