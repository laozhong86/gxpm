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
  if (!cwd || !existsSync(join(cwd, ".gxpm", "issues"))) {
    return { action: "allow", exitCode: 0 };
  }

  const parts: string[] = [];

  const schema = readSchemaVersion(cwd);
  const version = readVersion(cwd);
  parts.push(
    `This repo uses gxpm (schema v${schema}, version ${version}). Run \`gxpm issue list\` to see active work, \`gxpm issue status <id>\` to load context.`,
  );

  const updateCtx = checkUpdate(cwd);
  if (updateCtx) parts.push(updateCtx);

  const wikiCtx = getWikiContext(cwd);
  if (wikiCtx) parts.push(wikiCtx);

  triggerWikiUpdate(cwd);

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
  if (!match || !cwd) {
    return { action: "allow", exitCode: 0 };
  }

  const issueId = match[0].toUpperCase();
  const statePath = join(cwd, ".gxpm", "issues", issueId, "state.json");
  if (!existsSync(statePath)) {
    return { action: "allow", exitCode: 0 };
  }

  const lines: string[] = [];
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

  const RECORDABLE_TOOLS = ["update_plan", "ExitPlanMode"];
  if (!toolName || !RECORDABLE_TOOLS.includes(toolName) || !cwd) {
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
  _input: HookInput,
): Promise<HookResult> {
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

function getWikiContext(cwd: string): string | null {
  try {
    const out = execSync("gxpm wiki status --json", {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const wiki = JSON.parse(out);
    if (typeof wiki !== "object" || wiki === null || Array.isArray(wiki)) {
      return null;
    }
    const native = (wiki as Record<string, unknown>).native ?? wiki;
    if (typeof native !== "object" || native === null) return null;
    const n = native as Record<string, unknown>;
    if (!n.detected) return null;
    const parts: string[] = [];
    const root = String(n.repoWikiRoot ?? "");
    const stale = !!n.stale;
    parts.push(`gxpm native wiki detected (${root}.gxpm/wiki${stale ? " stale" : ""}).`);
    if (stale) {
      parts.push("Auto-updating wiki in background. Results may be stale for the first query.");
    }
    const docs = Array.isArray(n.docs) ? n.docs : [];
    if (docs.length > 0) {
      parts.push(`Docs: ${docs.slice(0, 3).join(", ")}`);
    }
    return parts.join("\n");
  } catch {
    return null;
  }
}

function triggerWikiUpdate(cwd: string): void {
  try {
    execSync("gxpm wiki update >/dev/null 2>&1 &", {
      cwd,
      stdio: "ignore",
      shell: "/bin/bash",
    });
  } catch {
    // ignore
  }
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
