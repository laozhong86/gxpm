const TOP_LEVEL_USAGE = `Usage: gxpm <command> [subcommand] [args...]

Commands:
  version, --version, -v      Print gxpm version
  check                       Run scaffold check
  doctor [--fix] [--json]     Run health check (optionally fix)
  config <get|set|...>        Read/write gxpm config
  worktree <policy|...>       Worktree policy commands
  init                        Initialize gxpm in current repo
  upgrade / post-upgrade      Run upgrade workflow
  issue <create|list|status|next|transition|...>    Manage issues
  artifact <list|read|write|edit>                  Manage phase artifacts
  gate <run|...>              Run phase gates
  verify <ac-check|...>       Verification commands
  wiki <init|update|query>    Local wiki commands
  workspace ensure <id>       Prepare workspace/worktree for an issue
  autopilot <start|status|stop|list>               Autopilot grants
  feedback <create|list>      Cross-repo feedback issues
  phase <rewind|...>          Phase utilities
  specify <init|confirm>      BDD specify-phase commands
  hook <install|list|...>     Host hook commands
  preset <list|apply|...>     Preset commands
  cleanup land <id>           Post-land cleanup
  run / orchestrator          DAG runtime
  global-discover             Discover installed gxpm projects
  dag / workflow              Workflow engine
  session-id                  Print current session id

Phase artifact init commands (auto-routed):
  gxpm triage init <id>     gxpm plan init <id>          gxpm dispatch init <id>
  gxpm specify init <id>    gxpm implement verify <id>   gxpm local-verify ac-check <id>
  gxpm ac-check self-review <id>                          gxpm self-review cleanup <id>
  gxpm cleanup ship <id>    gxpm ship pr-check <id>      gxpm pr-check verify <id>
  gxpm verify qa <id>       gxpm qa land <id>

Run 'gxpm <command> --help' to see usage for a specific command.`;

const COMMAND_USAGE: Record<string, string> = {
  artifact: `Usage:
  gxpm artifact list <issue-id>
  gxpm artifact read <issue-id> <type>
  gxpm artifact write <issue-id> <type> [--probe-cli] --json <json> | --from <file> | --stdin
  gxpm artifact edit <issue-id> <type>`,
  issue: `Usage:
  gxpm issue create [<issue-id>|--auto-id] [--type feature|meta|spike] [--parent <id>]
  gxpm issue list [--all]
  gxpm issue status <issue-id>
  gxpm issue next <issue-id>
  gxpm issue context [<issue-id>|--auto]
  gxpm issue resume <issue-id>
  gxpm issue transition <issue-id> <next-phase> [--skip-cleanup]
  gxpm issue checkpoint <issue-id> --title "..." (--stdin|--json|--from)`,
  gate: `Usage:
  gxpm gate run <issue-id> <next-phase>
  gxpm gate inspect <issue-id>`,
  verify: `Usage:
  gxpm verify <subcommand> <issue-id>
  Phase artifact: 'gxpm verify qa <issue-id>' (transitions verify -> qa, drafts qa-findings)`,
  wiki: `Usage:
  gxpm wiki init [--from <path>]
  gxpm wiki update
  gxpm wiki query <text>`,
  workspace: `Usage:
  gxpm workspace ensure <issue-id>`,
  autopilot: `Usage:
  gxpm autopilot start <issue-id>|--auto-id --profile <name> [--prompt "..."]
  gxpm autopilot status <issue-id>
  gxpm autopilot list
  gxpm autopilot stop <issue-id> --reason "..."`,
  feedback: `Usage:
  gxpm feedback create [--type ...]
  gxpm feedback list`,
  phase: `Usage:
  gxpm phase rewind <issue-id> --to <phase> --reason "..."`,
  specify: `Usage:
  gxpm specify init <issue-id>
  gxpm specify confirm <issue-id> --by <name>`,
  hook: `Usage:
  gxpm hook install [--host claude|codex|kimi]
  gxpm hook list`,
  preset: `Usage:
  gxpm preset list
  gxpm preset apply <name>`,
  cleanup: `Usage:
  gxpm cleanup land <issue-id> [--execute] [--force]`,
  config: `Usage:
  gxpm config get <key>
  gxpm config set <key> <value>`,
  worktree: `Usage:
  gxpm worktree policy`,
  doctor: `Usage:
  gxpm doctor [--fix] [--json]`,
  upgrade: `Usage:
  gxpm upgrade [--to <version>]`,
  init: `Usage:
  gxpm init [<target-path>] [--with-hooks]`,
  capability: `Usage:
  gxpm capability list <issue-id>`,
  run: `Usage:
  gxpm run <workflow-id>`,
  orchestrator: `Usage:
  gxpm orchestrator <subcommand>`,
  dag: `Usage:
  gxpm dag <list|validate|run>`,
  workflow: `Usage:
  gxpm workflow <subcommand>`,
  preset_list: `Usage: gxpm preset list`,
};

export function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function getCommandUsage(command: string | undefined, _subcommand?: string | undefined): string {
  if (!command) return TOP_LEVEL_USAGE;
  const usage = COMMAND_USAGE[command];
  if (usage) return usage;
  return `${TOP_LEVEL_USAGE}\n\n(No specific usage registered for '${command}'; showing top-level help.)`;
}

export function getTopLevelUsage(): string {
  return TOP_LEVEL_USAGE;
}
