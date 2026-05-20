/**
 * GXPM-167: `gxpm guard tool <tool> [--issue <id>] [--json]`
 *
 * Thin CLI wrapper over GXPM-144's queryToolPermission. Designed to be
 * consumed by host pre-tool-use hooks (Claude Code, Codex, Kimi):
 *   $ gxpm guard tool "git push --force" --issue GXPM-42 --json
 *   {"allow":false,"decision":"block","reason":"phase=self-review forbids ..."}
 *   exit code 1
 *
 * Default-allow: when no issue can be inferred or phase has no
 * restrictions, allow with a clear reason — hooks should treat
 * unknown context as permissive, not restrictive.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { queryToolPermission } from "../../core/role-capability-gate";
import { readIssueState } from "../../core/state";

const USAGE =
  "Usage: gxpm guard tool <tool> [--issue <id>] [--json]\n" +
  "  Queries whether a tool/command is allowed in the current issue's phase.\n" +
  "  Exit code 0 = allowed; 1 = blocked.\n" +
  "  --issue: explicit issue id; otherwise inferred from .gxpm-worktree-owner.json in cwd.\n" +
  "  --json: emit hook-compatible JSON { allow, decision, reason }.";

interface GuardResult {
  allow: boolean;
  decision: "approve" | "block";
  reason: string;
  issueId?: string;
  phase?: string;
}

export function runGuardCommand(argv: string[], subcommand: string | undefined): void {
  if (subcommand === "--help" || subcommand === "-h" || subcommand === undefined) {
    console.log(USAGE);
    return;
  }
  if (subcommand !== "tool") {
    throw new Error(`Unknown guard subcommand: ${subcommand}\n${USAGE}`);
  }

  const positional = argv.filter((arg) => !arg.startsWith("--"));
  // positional[0]="guard", [1]="tool", [2]=<tool>
  const tool = positional[2];
  if (!tool) {
    throw new Error(USAGE);
  }

  const issueIdx = argv.indexOf("--issue");
  const explicitIssueId = issueIdx >= 0 ? argv[issueIdx + 1] : undefined;
  const wantJson = argv.includes("--json");

  const issueId = explicitIssueId ?? inferIssueIdFromCwd();
  const result = evaluateGuard(tool, issueId);

  if (wantJson) {
    console.log(JSON.stringify(result));
  } else {
    const prefix = result.allow ? "allow" : "deny";
    console.log(`${prefix}: ${result.reason}`);
    if (result.issueId) console.log(`issueId: ${result.issueId}`);
    if (result.phase) console.log(`phase: ${result.phase}`);
  }

  if (!result.allow) {
    process.exit(1);
  }
}

function inferIssueIdFromCwd(): string | undefined {
  const ownerPath = join(process.cwd(), ".gxpm-worktree-owner.json");
  if (!existsSync(ownerPath)) return undefined;
  try {
    const owner = JSON.parse(readFileSync(ownerPath, "utf-8")) as { ownerIssueId?: string };
    return owner.ownerIssueId;
  } catch {
    return undefined;
  }
}

function evaluateGuard(tool: string, issueId: string | undefined): GuardResult {
  if (!issueId) {
    return {
      allow: true,
      decision: "approve",
      reason: "no issue context (cwd has no .gxpm-worktree-owner.json and --issue not provided); defaulting to allow",
    };
  }
  let state;
  try {
    state = readIssueState({ issueId });
  } catch {
    return {
      allow: true,
      decision: "approve",
      reason: `issue ${issueId} not found; defaulting to allow`,
      issueId,
    };
  }
  const decision = queryToolPermission(tool, state.currentPhase);
  return {
    allow: decision.allowed,
    decision: decision.allowed ? "approve" : "block",
    reason: decision.reason,
    issueId,
    phase: state.currentPhase,
  };
}
