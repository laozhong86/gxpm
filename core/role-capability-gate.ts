/**
 * GXPM-144: Agent Runtime v0 — phase-aware tool permission query layer.
 *
 * Pure-function API that callers (hooks, future CLI enforcement,
 * role-scoped subagents) can consult to decide whether a given tool /
 * command should be available in the current phase.
 *
 * Default-allow: unknown tools pass. Restrictions are an allow-list of
 * *blocked* operations per phase. Enforcement (wrapping git, intercepting
 * Bash) is deliberate follow-up scope.
 */

import type { GxpmPhase } from "./state";

export const PHASE_TOOL_RESTRICTIONS: Partial<Record<GxpmPhase, readonly string[]>> = {
  "self-review": [
    "git push --force",
    "git push -f",
    "gxpm cleanup land",
    "gxpm autopilot stop --force",
  ],
  "ac-check": ["git push --force", "git push -f", "gxpm cleanup land"],
  "pr-check": ["git push --force", "git push -f", "gxpm cleanup land"],
  "verify": [
    "git push --force",
    "git push -f",
    "gxpm cleanup land",
    "gxpm phase rewind",
  ],
  "qa": ["git push --force", "git push -f", "gxpm cleanup land"],
};

export interface ToolPermissionDecision {
  allowed: boolean;
  reason: string;
  matchedRestriction?: string;
}

export function isToolAllowedInPhase(tool: string, phase: GxpmPhase): boolean {
  return queryToolPermission(tool, phase).allowed;
}

export function queryToolPermission(tool: string, phase: GxpmPhase): ToolPermissionDecision {
  const restrictions = PHASE_TOOL_RESTRICTIONS[phase];
  if (!restrictions || restrictions.length === 0) {
    return { allowed: true, reason: `phase=${phase} has no tool restrictions` };
  }
  const normalized = tool.trim();
  for (const banned of restrictions) {
    if (normalized === banned || normalized.startsWith(`${banned} `)) {
      return {
        allowed: false,
        reason: `phase=${phase} forbids '${banned}'; complete the phase or use 'gxpm phase rewind' before performing this operation`,
        matchedRestriction: banned,
      };
    }
  }
  return { allowed: true, reason: `phase=${phase} permits '${normalized}'` };
}

export function getRestrictionsForPhase(phase: GxpmPhase): readonly string[] {
  return PHASE_TOOL_RESTRICTIONS[phase] ?? [];
}
