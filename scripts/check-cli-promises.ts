/**
 * GXPM-139: Static check that every `gxpm xxx` command advertised by
 *
 *   - scripts/commands/issue.ts  (printNextSteps templates)
 *   - core/phase-gates.ts        (PHASE_GATE_RULES transitions)
 *   - core/phase-artifact.ts     (phase-init commands)
 *   - scripts/phase-artifact-commands.ts
 *
 * resolves to a real subcommand registered in scripts/gxpm.ts.
 *
 * Without this check, `issue next` can advertise a command that the
 * installed CLI doesn't recognize — forcing agents to violate CANON #4 by
 * hand-editing artifact JSON.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;

const SOURCES_TO_SCAN = [
  "scripts/commands/issue.ts",
  "core/phase-gates.ts",
  "core/phase-artifact.ts",
  "scripts/phase-artifact-commands.ts",
];

const ROUTER_FILE = "scripts/gxpm.ts";

// Match `gxpm <root>` only when followed by something that looks like a real
// argument: <placeholder>, --flag, or a known sub-verb. This avoids false
// positives on English prose like "gxpm requires feature branches...".
const SUB_VERBS = [
  "init", "write", "edit", "read", "list", "status", "next", "transition",
  "context", "resume", "create", "checkpoint", "inspect", "run", "verify",
  "ac-check", "self-review", "cleanup", "ship", "pr-check", "qa", "land",
  "start", "stop", "apply", "policy", "get", "set", "confirm", "rewind",
  "install", "uninstall", "update", "query", "ensure",
].join("|");
const COMMAND_PATTERN = new RegExp(
  String.raw`\bgxpm\s+([a-z][a-z0-9-]*)\s+(?:<|--|` + SUB_VERBS + String.raw`)\b`,
  "gi",
);

const IGNORE_ROOTS = new Set([
  "version",
  "--version",
  "-v",
  "help",
  "--help",
  "issue", // routed; subcommands validated separately below
  "artifact",
  "gate",
  "verify",
  "wiki",
  "init",
  "doctor",
  "upgrade",
  "post-upgrade",
  "config",
  "worktree",
  "capability",
  "feedback",
  "phase",
  "specify",
  "autopilot",
  "workspace",
  "hook",
  "preset",
  "dag",
  "workflow",
  "run",
  "orchestrator",
  "global-discover",
  "session-id",
  "cleanup",
  "check",
  // Phase artifact init commands (auto-routed via findPhaseArtifactCommand):
  "triage",
  "plan",
  "dispatch",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "qa",
]);

export interface CheckResult {
  ok: boolean;
  missing: Array<{ command: string; source: string }>;
  inspected: string[];
}

function extractCommands(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(COMMAND_PATTERN)) {
    out.add(match[1]);
  }
  return out;
}

function isCommandRegistered(routerSource: string, command: string): boolean {
  if (IGNORE_ROOTS.has(command)) return true;
  // Routes look like:   if (command === "X")
  const pattern = new RegExp(`command\\s*===\\s*"${command}"`);
  return pattern.test(routerSource);
}

export function checkCliPromises(repoRoot: string = REPO_ROOT): CheckResult {
  const routerSource = readFileSync(join(repoRoot, ROUTER_FILE), "utf-8");
  const missing: Array<{ command: string; source: string }> = [];
  const inspected: string[] = [];

  for (const rel of SOURCES_TO_SCAN) {
    const path = join(repoRoot, rel);
    let source: string;
    try {
      source = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    inspected.push(rel);
    const commands = extractCommands(source);
    for (const cmd of commands) {
      if (!isCommandRegistered(routerSource, cmd)) {
        missing.push({ command: cmd, source: rel });
      }
    }
  }

  return { ok: missing.length === 0, missing, inspected };
}

export function formatCheckResult(result: CheckResult): string {
  if (result.ok) {
    return `✅ check-cli-promises: ${result.inspected.length} source(s) scanned, all advertised gxpm commands resolve to registered subcommands.`;
  }
  const lines = ["❌ check-cli-promises: advertised commands not registered in scripts/gxpm.ts"];
  for (const item of result.missing) {
    lines.push(`  - gxpm ${item.command}   (referenced in ${item.source})`);
  }
  lines.push("");
  lines.push("Fix: either register the command in scripts/gxpm.ts router, or stop advertising it in issue next / phase-gate templates.");
  return lines.join("\n");
}

// CLI entry: bun run scripts/check-cli-promises.ts
if (import.meta.main) {
  const result = checkCliPromises();
  console.log(formatCheckResult(result));
  if (!result.ok) process.exit(1);
}
