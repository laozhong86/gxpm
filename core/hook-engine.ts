/**
 * Unified hook engine for gxpm.
 *
 * All host-specific hooks (Claude Code, Codex CLI, Kimi, Cursor) call
 * `gxpm hook <event> --host <host>` which delegates to this engine.
 * Business logic is host-agnostic; output is formatted per-host.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatProjectInitializationContext,
  getProjectInitializationStatus,
} from "./project-init-status";
import { readWorktreeOwner } from "./worktree-owner";
import { queryToolPermission } from "./role-capability-gate";
import { readIssueState } from "./state";
import { PHASE_GATE_RULES } from "./phase-gates";

export type HookHostName = "claude" | "codex" | "cursor" | "kimi";

export interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  // Tool events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  // Prompt events
  prompt?: string;
  turn_id?: string;
  // Stop events
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
  // SessionStart events
  source?: string;
  [key: string]: unknown;
}

export interface HookResult {
  action: "allow" | "block";
  reason?: string;
  additionalContext?: string;
  exitCode: number;
}

/** Detect host from well-known environment variables. */
export function detectHostFromEnv(): HookHostName | null {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude";
  return null;
}

export function isValidHookHost(name: string): name is HookHostName {
  return ["claude", "codex", "cursor", "kimi"].includes(name);
}

/** Main dispatcher — routes by event type to the appropriate processor. */
export async function processHook(
  host: HookHostName,
  event: string,
  input: HookInput,
): Promise<HookResult> {
  switch (event) {
    case "SessionStart":
      return processSessionStart(host, input);
    case "UserPromptSubmit":
      return processUserPromptSubmit(host, input);
    case "PreToolUse":
      return processPreToolUse(host, input);
    case "Stop":
      return processStop(host, input);
    case "PostToolUse":
      return processPostToolUse(host, input);
    default:
      return { action: "allow", exitCode: 0 };
  }
}

/**
 * Format a HookResult into the JSON / text shape expected by the target host.
 *
 * Rules per host + event:
 * - Codex  SessionStart/UserPromptSubmit:  hookSpecificOutput.additionalContext
 * - Codex  PreToolUse/PermissionRequest:    hookSpecificOutput.permissionDecision
 * - Codex  Stop:                            decision: block + reason (continues)
 * - Claude SessionStart:                    plain text stdout
 * - Claude UserPromptSubmit/others:         JSON additionalContext
 * - Claude PreToolUse:                      JSON permissionDecision
 * - Kimi   (block only):                    JSON permissionDecision (context injection unsupported)
 */
export function formatHookOutput(
  host: HookHostName,
  event: string,
  result: HookResult,
): string {
  if (result.action === "allow" && !result.additionalContext) {
    return "";
  }

  // Codex ---------------------------------------------------------------
  if (host === "codex") {
    if (result.additionalContext) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: result.additionalContext,
        },
      });
    }
    if (result.action === "block" && result.reason) {
      if (event === "Stop") {
        return JSON.stringify({ decision: "block", reason: result.reason });
      }
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      });
    }
    return "";
  }

  // Claude --------------------------------------------------------------
  if (host === "claude") {
    if (event === "SessionStart" && result.additionalContext) {
      return result.additionalContext;
    }
    if (result.additionalContext) {
      return JSON.stringify({ additionalContext: result.additionalContext });
    }
    if (result.action === "block") {
      // Claude Stop hook schema rejects `hookSpecificOutput.hookEventName="Stop"`;
      // it only accepts the top-level `{decision:"block", reason}` shape (same as Codex Stop).
      if (event === "Stop" && result.reason) {
        return JSON.stringify({ decision: "block", reason: result.reason });
      }
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      });
    }
    return "";
  }

  // Kimi ----------------------------------------------------------------
  if (host === "kimi") {
    if (result.action === "block" && result.reason) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      });
    }
    // Kimi does not support context injection for SessionStart/UserPromptSubmit,
    // but we emit anyway; the host ignores it.
    if (result.additionalContext) {
      return result.additionalContext;
    }
    return "";
  }

  // Cursor / fallback ----------------------------------------------------
  return "";
}

// =======================================================================
// Event processors
// =======================================================================

async function processSessionStart(
  _host: HookHostName,
  input: HookInput,
): Promise<HookResult> {
  const cwd = input.cwd;
  if (!cwd) {
    return { action: "allow", exitCode: 0 };
  }

  const initStatus = getProjectInitializationStatus(cwd);
  if (initStatus.kind !== "initialized") {
    if (initStatus.kind === "partial" || hasRepoScopedGxpmHookConfig(cwd)) {
      const context = formatProjectInitializationContext(initStatus);
      if (context) {
        return { action: "allow", additionalContext: context, exitCode: 0 };
      }
    }
    return { action: "allow", exitCode: 0 };
  }

  const parts: string[] = [];

  const worktreeCtx = getWorktreeContext(cwd);
  if (worktreeCtx) parts.push(worktreeCtx);

  // GXPM-187: when cwd is inside a gxpm worktree, prepend an identity
  // block (issue / phase / requiredSkill / recent commits) so the agent
  // can re-anchor after context compaction without manual recall.
  const identitySummary = buildSessionStartIdentitySummary(cwd);
  if (identitySummary) parts.push(identitySummary);

  const schema = readSchemaVersion(cwd);
  const version = readVersion(cwd);
  parts.push(
    `This repo uses gxpm (schema v${schema}, version ${version}). Run \`gxpm issue list\` to see active work, \`gxpm issue status <id>\` to load context.`,
  );

  const updateCtx = checkUpdate(cwd);
  if (updateCtx) parts.push(updateCtx);

  return {
    action: "allow",
    additionalContext: parts.join("\n\n"),
    exitCode: 0,
  };
}

async function processUserPromptSubmit(
  _host: HookHostName,
  input: HookInput,
): Promise<HookResult> {
  const prompt = input.prompt ?? "";
  const cwd = input.cwd;

  const match = prompt.match(/\b(GXG|GXPM)-\d+\b/i);
  if (!cwd) {
    return { action: "allow", exitCode: 0 };
  }
  if (!match && !existsSync(join(cwd, ".gxpm", "issues"))) {
    return { action: "allow", exitCode: 0 };
  }

  const lines: string[] = [];

  // Scope drift detection: if current directory has a worktree owner marker,
  // warn when prompt mentions an unrelated issue.
  if (match && cwd) {
    const mentionedIssue = match[0].toUpperCase();
    const owner = readWorktreeOwner(cwd);
    if (owner && !owner.linkedIssues.includes(mentionedIssue)) {
      lines.push(`⚠️ SCOPE DRIFT DETECTED ⚠️`);
      lines.push(`Current worktree is owned by ${owner.ownerIssueId} (linked: ${owner.linkedIssues.join(", ")}).`);
      lines.push(`You mentioned ${mentionedIssue} which is NOT in this batch.`);
      lines.push(`RULE: If you need to work on ${mentionedIssue}, create it as a child issue first:`);
      lines.push(`  gxpm issue create --auto-id --parent ${owner.ownerIssueId}`);
      lines.push(`Or switch to a different worktree/session.`);
      lines.push("");
    }
  }

  if (match) {
    const issueId = match[0].toUpperCase();
    const statePath = join(cwd, ".gxpm", "issues", issueId, "state.json");
    if (existsSync(statePath)) {
      lines.push(`gxpm context for ${issueId} (referenced in prompt):`);

      const sessionId = getSessionId(cwd);
      const currentOwner = getCurrentOwner(cwd, issueId);
      if (sessionId && currentOwner && currentOwner !== sessionId) {
        const wasOwner = checkOwnershipHistory(cwd, issueId, sessionId);
        if (wasOwner) {
          lines.push("");
          lines.push(`ownership transferred: current owner is ${currentOwner}`);
        }
      }

      lines.push("");

      const contextOutput = getIssueContext(cwd, issueId);
      if (contextOutput) {
        lines.push(contextOutput);
      } else {
        const statusOutput = getIssueStatus(cwd, issueId);
        const nextOutput = getIssueNext(cwd, issueId);
        if (statusOutput) lines.push(statusOutput);
        if (nextOutput) lines.push(nextOutput);
      }
    }
  }

  const { formatAutopilotGrantContext, listActiveAutopilotGrants } = await import("./autopilot");
  const activeGrants = listActiveAutopilotGrants({
    root: cwd,
    issueId: match ? match[0].toUpperCase() : undefined,
    limit: match ? 1 : 3,
  });
  const grantContext = formatAutopilotGrantContext(activeGrants);
  if (grantContext) {
    if (lines.length > 0) lines.push("");
    lines.push(grantContext);
  }

  if (lines.length === 0) {
    return { action: "allow", exitCode: 0 };
  }

  return {
    action: "allow",
    additionalContext: lines.join("\n"),
    exitCode: 0,
  };
}

async function processPreToolUse(
  _host: HookHostName,
  input: HookInput,
): Promise<HookResult> {
  const toolName = input.tool_name;
  const cwd = input.cwd;

  // GXPM-168/171: shell gate — block forbidden commands in review/qa/verify
  // phases. Recognizes multiple shell-style tool names across hosts
  // (Bash=Claude, shell/bash=Codex, run_command=Kimi).
  if (toolName && SHELL_TOOL_NAMES.has(toolName) && cwd) {
    const bashGate = evaluateBashToolGate(input);
    if (bashGate && !bashGate.allow) {
      return { action: "block", reason: bashGate.reason, exitCode: 2 };
    }
  }

  const RECORDABLE_TOOLS = ["update_plan", "ExitPlanMode"];
  if (!toolName || !RECORDABLE_TOOLS.includes(toolName) || !cwd) {
    return { action: "allow", exitCode: 0 };
  }

  if (getProjectInitializationStatus(cwd).kind !== "initialized") {
    return { action: "allow", exitCode: 0 };
  }

  const args = JSON.stringify({
    tool_name: toolName,
    arguments: input.tool_input ?? input.arguments,
  });

  const issueId = getActiveIssueId(cwd);
  const logDir = issueId
    ? join(cwd, ".gxpm", "issues", issueId)
    : join(cwd, ".gxpm");
  const logPath = issueId
    ? join(logDir, "codex-plans.jsonl")
    : join(logDir, "codex-plans-orphan.jsonl");

  mkdirSync(logDir, { recursive: true });
  writeFileSync(logPath, args + "\n", { flag: "a" });

  return { action: "allow", exitCode: 0 };
}

async function processStop(
  _host: HookHostName,
  input: HookInput,
): Promise<HookResult> {
  if (input.stop_hook_active) {
    return { action: "allow", exitCode: 0 };
  }
  const cwd = input.cwd;
  if (!cwd) {
    return { action: "allow", exitCode: 0 };
  }
  const {
    buildAutopilotStopContinuation,
    listActiveAutopilotGrants,
    filterAutopilotGrantsForHook,
  } = await import("./autopilot");
  const allActive = listActiveAutopilotGrants({ root: cwd, limit: 3 });
  const owner = readWorktreeOwner(cwd);
  const scoped = filterAutopilotGrantsForHook(allActive, {
    sessionId: input.session_id,
    ownerIssueId: owner?.ownerIssueId,
  });
  const continuation = buildAutopilotStopContinuation(scoped);
  if (continuation) {
    return { action: "block", reason: continuation, exitCode: 2 };
  }
  return { action: "allow", exitCode: 0 };
}

async function processPostToolUse(
  _host: HookHostName,
  _input: HookInput,
): Promise<HookResult> {
  return { action: "allow", exitCode: 0 };
}

// =======================================================================
// Helpers
// =======================================================================

function buildSessionStartIdentitySummary(cwd: string): string | null {
  const owner = readWorktreeOwner(cwd);
  if (!owner) return null;
  let requiredSkill: string | null = null;
  try {
    const state = readIssueState({ root: process.cwd(), issueId: owner.ownerIssueId });
    const rule = PHASE_GATE_RULES.find((r) => r.phase === state.currentPhase);
    requiredSkill = rule?.requiredSkill ?? null;
  } catch {
    // owner present but state lookup failed (e.g. cwd != main repo). Best-effort.
  }
  let recentCommits: Array<{ sha: string; subject: string }> = [];
  try {
    const raw = execSync('git log -3 --pretty=format:"%h\t%s"', {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    recentCommits = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha: sha.replace(/^"|"$/g, ""), subject: rest.join("\t").replace(/^"|"$/g, "") };
      });
  } catch {
    // git not available or worktree not a git repo
  }
  return formatWorktreeIdentitySummary({
    cwd,
    requiredSkill,
    recentCommits,
  });
}

/**
 * GXPM-187: format a worktree identity summary for SessionStart hook injection.
 *
 * When the agent's cwd is inside a gxpm worktree (i.e. `.gxpm-worktree-owner.json`
 * exists), emit a compact block containing issue id, phase, branch, the skill
 * the agent must invoke for the current phase, and the most recent commits.
 *
 * The combined output is hard-capped at `maxBytes` (default 2048) — when the
 * raw body exceeds the budget, commit lines are dropped from the tail and a
 * `… (truncated)` sentinel is appended. ownerIssueId / phase / requiredSkill
 * are always preserved.
 */
export function formatWorktreeIdentitySummary(opts: {
  cwd: string;
  requiredSkill?: string | null;
  recentCommits?: Array<{ sha: string; subject: string }>;
  maxBytes?: number;
}): string | null {
  const owner = readWorktreeOwner(opts.cwd);
  if (!owner) return null;
  const maxBytes = opts.maxBytes ?? 2048;
  const headerLines: string[] = [
    `gxpm worktree identity:`,
    `- issue: ${owner.ownerIssueId}`,
    `- phase: ${owner.currentPhase ?? "(unknown)"}`,
  ];
  if (owner.branchName) headerLines.push(`- branch: ${owner.branchName}`);
  headerLines.push(`- requiredSkill: ${opts.requiredSkill ?? "(none)"}`);
  const header = headerLines.join("\n");

  const commitLines: string[] = [];
  if (opts.recentCommits && opts.recentCommits.length > 0) {
    commitLines.push(`- recent commits:`);
    for (const c of opts.recentCommits) {
      commitLines.push(`  - ${c.sha.slice(0, 7)} ${c.subject}`);
    }
  }

  const fullBody = commitLines.length > 0 ? `${header}\n${commitLines.join("\n")}` : header;
  if (Buffer.byteLength(fullBody, "utf8") <= maxBytes) {
    return fullBody;
  }

  const suffix = "\n… (truncated)";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let candidate = header;
  for (const line of commitLines) {
    const next = `${candidate}\n${line}`;
    if (Buffer.byteLength(next, "utf8") > budget) break;
    candidate = next;
  }
  return candidate + suffix;
}

function getWorktreeContext(cwd: string): string | null {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    return null;
  }

  let branch: string;
  try {
    branch = execSync("git symbolic-ref --short HEAD", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }

  if (!branch || branch === "main" || branch === "master") {
    return null;
  }

  let gitPath: string;
  try {
    gitPath = execSync("git rev-parse --git-path HEAD", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }

  if (gitPath.includes("/worktrees/")) {
    return null;
  }

  return `WARNING: You are on branch '${branch}' in the canonical main checkout. gxpm worktree.enforcement is required. Create a worktree before editing code: gxpm workspace ensure <issue-id>`;
}

function hasRepoScopedGxpmHookConfig(cwd: string): boolean {
  for (const file of [
    join(cwd, ".codex", "hooks.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".kimi", "config.toml"),
  ]) {
    try {
      if (readFileSync(file, "utf8").includes("gxpm hook")) {
        return true;
      }
    } catch {
      // absent or unreadable host config; fail open
    }
  }
  return false;
}

function readSchemaVersion(cwd: string): number {
  const stateFile = join(cwd, "core", "state.ts");
  if (!existsSync(stateFile)) return 1;
  try {
    const content = readFileSync(stateFile, "utf8");
    const m = content.match(/\bCURRENT_SCHEMA_VERSION\s*=\s*([0-9]+)\b/);
    return m ? parseInt(m[1], 10) : 1;
  } catch {
    return 1;
  }
}

function readVersion(cwd: string): string {
  // GXPM-173: package.json is the single source of truth for version.
  // The legacy VERSION file is preserved as a fallback for one release cycle
  // so older checkouts don't lose telemetry; remove this branch in 0.3.0.
  const pkg = join(cwd, "package.json");
  if (existsSync(pkg)) {
    try {
      const { version } = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
      if (typeof version === "string" && version.length > 0) {
        return version.slice(0, 40);
      }
    } catch {
      // fall through to legacy
    }
  }
  const vf = join(cwd, "VERSION");
  if (!existsSync(vf)) return "dev";
  try {
    const v = readFileSync(vf, "utf8").trim();
    return v.slice(0, 40) || "dev";
  } catch {
    return "dev";
  }
}

function checkUpdate(cwd: string): string | null {
  const envBin = process.env.GXPM_UPDATE_CHECK_BIN;
  const candidates = envBin ? [envBin] : [];
  try {
    const found = execSync("command -v gxpm-update-check 2>/dev/null", {
      encoding: "utf8",
      shell: "/bin/bash",
      cwd,
    }).trim();
    if (found) candidates.push(found);
  } catch {
    // ignore
  }
  for (const bin of candidates) {
    try {
      const out = execSync(bin, { encoding: "utf8", cwd }).trim();
      if (out.startsWith("UPGRADE_AVAILABLE")) {
        const parts = out.split(/\s+/);
        if (parts[1] && parts[2]) {
          return `gxpm update available: ${parts[1]} -> ${parts[2]}.`;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function getSessionId(cwd: string): string | null {
  try {
    const out = execSync("gxpm session-id", {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getCurrentOwner(cwd: string, issueId: string): string | null {
  try {
    const out = execSync(`gxpm issue ownership "${issueId}" --field currentSession`, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function checkOwnershipHistory(cwd: string, issueId: string, sessionId: string): boolean {
  try {
    execSync(`gxpm issue ownership "${issueId}" --history-contains "${sessionId}"`, {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function getIssueContext(cwd: string, issueId: string): string | null {
  try {
    const out = execSync(`gxpm issue context "${issueId}"`, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getIssueStatus(cwd: string, issueId: string): string | null {
  try {
    const out = execSync(`gxpm issue status "${issueId}"`, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getIssueNext(cwd: string, issueId: string): string | null {
  try {
    const out = execSync(`gxpm issue next "${issueId}"`, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * GXPM-168: query role-capability-gate for Bash tool commands.
 * Returns null when no decision can be made (no issue context / not
 * initialized / bypass env set), in which case the caller defaults to allow.
 */
export function evaluateBashToolGate(
  input: HookInput,
): { allow: boolean; reason: string } | null {
  if (process.env.GXPM_BYPASS_TOOL_GATE === "1") {
    return { allow: true, reason: "GXPM_BYPASS_TOOL_GATE=1" };
  }
  const cwd = input.cwd;
  if (!cwd) return null;
  if (getProjectInitializationStatus(cwd).kind !== "initialized") return null;

  const command = extractBashCommand(input);
  if (!command) return null;

  // GXPM-168: prefer fast/local owner-file resolution; fall back to issue list
  let issueId: string | null = null;
  try {
    const owner = readWorktreeOwner(cwd);
    issueId = owner?.ownerIssueId ?? null;
  } catch {
    // ignore
  }
  if (!issueId) issueId = getActiveIssueId(cwd);
  if (!issueId) return null;

  let phase: string;
  try {
    const state = readIssueState({ root: cwd, issueId });
    phase = state.currentPhase;
  } catch {
    return null;
  }

  const decision = queryToolPermission(command, phase as never);
  return { allow: decision.allowed, reason: decision.reason };
}

// GXPM-171: shell tool names across hosts. Bash=Claude Code; shell/bash
// commonly appear in Codex hooks; run_command is Kimi's convention.
export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Bash",
  "bash",
  "shell",
  "run_command",
]);

function extractBashCommand(input: HookInput): string | undefined {
  const ti = input.tool_input ?? input.arguments;
  if (ti == null) return undefined;
  // GXPM-171: Codex-style hosts may pass tool_input as a raw command string.
  if (typeof ti === "string") return ti;
  if (typeof ti !== "object") return undefined;
  const record = ti as Record<string, unknown>;
  // Common keys across hosts: 'command' (Claude/Codex), 'cmd' (Kimi alt)
  const cmd = record.command ?? record.cmd;
  return typeof cmd === "string" ? cmd : undefined;
}

function getActiveIssueId(cwd: string): string | null {
  try {
    const out = execSync("gxpm issue list --json", {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const issues = JSON.parse(out);
    if (Array.isArray(issues) && issues.length === 1) {
      return (issues[0] as Record<string, unknown>)?.issueId as string ?? null;
    }
    return null;
  } catch {
    return null;
  }
}


