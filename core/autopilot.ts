import { randomUUID } from "node:crypto";
import { readArtifact, writeArtifact } from "./artifacts";
import { listIssues } from "./issues";
import { readIssueState, type GxpmPhase } from "./state";
import { resolveSessionId } from "./session";
import { appendBlockRecord } from "./autopilot-telemetry";

export const AUTOPILOT_PROFILES = ["full-delivery"] as const;

export type AutopilotProfile = (typeof AUTOPILOT_PROFILES)[number];
export type AutopilotGrantStatus = "active" | "stopped" | "completed" | "blocked";

export interface AutopilotGrant {
  schemaVersion: 1;
  mode: "autopilot";
  issueId: string;
  runId: string;
  profile: AutopilotProfile;
  status: AutopilotGrantStatus;
  startedAt: string;
  updatedAt: string;
  startedBySession: string;
  prompt?: string;
  expiresAt?: string;
  stoppedAt?: string;
  stopReason?: string;
  allowedActions: string[];
  hardStops: string[];
  terminalPhases: GxpmPhase[];
}

export interface ActiveAutopilotGrant {
  issueId: string;
  currentPhase: GxpmPhase;
  grant: AutopilotGrant;
}

interface StartAutopilotGrantInput {
  root?: string;
  issueId: string;
  profile?: AutopilotProfile;
  prompt?: string;
  ttlMinutes?: number;
  now?: Date;
}

interface StopAutopilotGrantInput {
  root?: string;
  issueId: string;
  reason?: string;
  now?: Date;
}

const DEFAULT_PROFILE: AutopilotProfile = "full-delivery";

const FULL_DELIVERY_ALLOWED_ACTIONS = [
  "issue.triage",
  "issue.plan",
  "issue.dispatch",
  "workspace.ensure",
  "code.modify",
  "artifact.write",
  "verification.run",
  "review.self",
  "git.commit",
  "git.push",
  "pull-request.create",
  "pull-request.update",
  "pull-request.merge",
  "issue.land",
  "cleanup.land",
];

const DEFAULT_HARD_STOPS = [
  "user.explicit_stop",
  "secrets_or_credentials_required",
  "paid_external_api_required",
  "production_data_or_destructive_data_migration",
  "irrecoverable_conflict_or_failed_verification",
  "policy_or_permission_boundary",
];

const TERMINAL_PHASES: GxpmPhase[] = ["land"];

export function startAutopilotGrant(input: StartAutopilotGrantInput): AutopilotGrant {
  const root = input.root ?? process.cwd();
  const profile = input.profile ?? DEFAULT_PROFILE;
  assertAutopilotProfile(profile);
  readIssueState({ root, issueId: input.issueId });

  const existing = readAutopilotGrant({ root, issueId: input.issueId });
  if (existing && isAutopilotGrantActive(existing, input.now)) {
    throw new Error(`Autopilot grant already active for ${input.issueId}`);
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const grant: AutopilotGrant = {
    schemaVersion: 1,
    mode: "autopilot",
    issueId: input.issueId,
    runId: randomUUID(),
    profile,
    status: "active",
    startedAt: nowIso,
    updatedAt: nowIso,
    startedBySession: resolveSessionId(),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.ttlMinutes ? { expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString() } : {}),
    allowedActions: [...FULL_DELIVERY_ALLOWED_ACTIONS],
    hardStops: [...DEFAULT_HARD_STOPS],
    terminalPhases: [...TERMINAL_PHASES],
  };

  writeArtifact({ root, issueId: input.issueId, type: "autopilot-grant", payload: grant });
  return grant;
}

export function stopAutopilotGrant(input: StopAutopilotGrantInput): AutopilotGrant {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  const existing = readAutopilotGrant({ root, issueId: input.issueId });
  if (!existing) {
    throw new Error(`Autopilot grant not found for ${input.issueId}`);
  }

  const now = input.now ?? new Date();
  const stopped: AutopilotGrant = {
    ...existing,
    status: "stopped",
    updatedAt: now.toISOString(),
    stoppedAt: now.toISOString(),
    stopReason: input.reason ?? "manual_stop",
  };
  writeArtifact({ root, issueId: input.issueId, type: "autopilot-grant", payload: stopped });

  // GXPM-164: record the block for later aggregation (Top-N analysis).
  // Best-effort: telemetry failure must not break the stop flow.
  try {
    appendBlockRecord({
      root,
      issueId: input.issueId,
      record: {
        at: now.toISOString(),
        reason: stopped.stopReason ?? "manual_stop",
        phase: state.currentPhase,
      },
    });
  } catch {
    // ignore — telemetry is observational
  }

  return stopped;
}

export function readAutopilotGrant(input: { root?: string; issueId: string }): AutopilotGrant | null {
  const root = input.root ?? process.cwd();
  try {
    const artifact = readArtifact({ root, issueId: input.issueId, type: "autopilot-grant" });
    return normalizeAutopilotGrant(artifact.payload);
  } catch {
    return null;
  }
}

export function listActiveAutopilotGrants(input: {
  root?: string;
  issueId?: string;
  limit?: number;
  now?: Date;
} = {}): ActiveAutopilotGrant[] {
  const root = input.root ?? process.cwd();
  const issueIds = input.issueId
    ? [input.issueId]
    : listIssues({ root, includeAll: true }).map((entry) => entry.issueId);
  const active: ActiveAutopilotGrant[] = [];

  for (const issueId of issueIds) {
    const grant = readAutopilotGrant({ root, issueId });
    if (!grant || !isAutopilotGrantActive(grant, input.now)) continue;
    let state;
    try {
      state = readIssueState({ root, issueId });
    } catch {
      continue;
    }
    if (grant.terminalPhases.includes(state.currentPhase)) continue;
    active.push({ issueId, currentPhase: state.currentPhase, grant });
    if (input.limit && active.length >= input.limit) break;
  }

  return active;
}

export function isAutopilotGrantActive(grant: AutopilotGrant, now: Date = new Date()): boolean {
  if (grant.status !== "active") return false;
  if (!grant.expiresAt) return true;
  return Date.parse(grant.expiresAt) > now.getTime();
}

export interface AutopilotHookScope {
  sessionId?: string;
  ownerIssueId?: string;
}

/**
 * Narrow Stop-hook interception to grants that belong to the current session
 * or the current worktree's owner issue. Without this filter the hook would
 * hijack unrelated sessions sharing the same cwd.
 */
export function filterAutopilotGrantsForHook(
  active: ActiveAutopilotGrant[],
  scope: AutopilotHookScope,
): ActiveAutopilotGrant[] {
  const { sessionId, ownerIssueId } = scope;
  if (!sessionId && !ownerIssueId) return active;
  return active.filter((item) => {
    if (sessionId && item.grant.startedBySession && item.grant.startedBySession === sessionId) {
      return true;
    }
    if (ownerIssueId && item.issueId === ownerIssueId) {
      return true;
    }
    return false;
  });
}

export function isAutopilotProfile(value: string): value is AutopilotProfile {
  return AUTOPILOT_PROFILES.includes(value as AutopilotProfile);
}

export function assertAutopilotProfile(value: string): asserts value is AutopilotProfile {
  if (!isAutopilotProfile(value)) {
    throw new Error(`Unsupported autopilot profile: ${value}`);
  }
}

export function formatAutopilotGrantContext(active: ActiveAutopilotGrant[]): string {
  if (active.length === 0) return "";
  const lines = ["gxpm autopilot grant active:"];
  for (const item of active) {
    lines.push(
      `- ${item.issueId}: profile=${item.grant.profile}, phase=${item.currentPhase}, runId=${item.grant.runId}`,
    );
  }
  lines.push("");
  lines.push("Autopilot Grant means the user pre-authorized gxpm workflow steps inside the profile.");
  lines.push("Do not ask for confirmation or clarification for allowed actions; plan, implement, verify, PR, merge/land, and cleanup autonomously.");
  lines.push("Stop only on hard stops, and persist the blocker/evidence in the current gxpm artifact before reporting.");
  lines.push("Useful commands: gxpm autopilot status <issue-id>; gxpm issue next <issue-id>.");
  return lines.join("\n");
}

export function buildAutopilotStopContinuation(active: ActiveAutopilotGrant[]): string {
  const context = formatAutopilotGrantContext(active);
  if (!context) return "";
  return `${context}\n\nContinue the gxpm workflow now. Do not produce a final answer while an active grant still has non-terminal work.`;
}

function normalizeAutopilotGrant(payload: unknown): AutopilotGrant | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Partial<AutopilotGrant>;
  if (value.schemaVersion !== 1) return null;
  if (value.mode !== "autopilot") return null;
  if (typeof value.issueId !== "string") return null;
  if (typeof value.runId !== "string") return null;
  if (typeof value.profile !== "string" || !isAutopilotProfile(value.profile)) return null;
  if (!["active", "stopped", "completed", "blocked"].includes(value.status ?? "")) return null;
  if (!Array.isArray(value.allowedActions)) return null;
  if (!Array.isArray(value.hardStops)) return null;
  return {
    schemaVersion: 1,
    mode: "autopilot",
    issueId: value.issueId,
    runId: value.runId,
    profile: value.profile,
    status: value.status as AutopilotGrantStatus,
    startedAt: stringOrNow(value.startedAt),
    updatedAt: stringOrNow(value.updatedAt),
    startedBySession: typeof value.startedBySession === "string" ? value.startedBySession : "",
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.stoppedAt === "string" ? { stoppedAt: value.stoppedAt } : {}),
    ...(typeof value.stopReason === "string" ? { stopReason: value.stopReason } : {}),
    allowedActions: value.allowedActions.filter((item): item is string => typeof item === "string"),
    hardStops: value.hardStops.filter((item): item is string => typeof item === "string"),
    terminalPhases: Array.isArray(value.terminalPhases)
      ? value.terminalPhases.filter((item): item is GxpmPhase => item === "land")
      : [...TERMINAL_PHASES],
  };
}

function stringOrNow(value: unknown): string {
  return typeof value === "string" ? value : new Date().toISOString();
}
