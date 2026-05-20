/**
 * gxpm skill — skill-load attestation CLI (GXPM-170 PR-1).
 *
 * Subcommands:
 *   gxpm skill ack <issue-id> <skill> [--proof <text>]
 *     Append a skill.load.satisfied event to .gxpm/issues/<id>/events.jsonl
 *     attesting that the agent invoked the contract-mapped skill before doing
 *     phase work. Rejects when the skill doesn't match the current phase's
 *     PHASE_GATE_RULES.requiredSkill, or when the issue is on a terminal phase.
 *
 * This PR (PR-1) is telemetry-only — no gate yet. PR-2 will add the gate that
 * reads these events to reject artifact writes / transitions when an
 * outstanding skill-load-required has no matching satisfied event.
 */

import { getIssuePaths, readIssueState, appendIssueEvent } from "../../core/state";
import { PHASE_GATE_RULES } from "../../core/phase-gates";
import { optionValue } from "./helpers";

export function runSkillCommand(
  argv: string[],
  subcommand: string | undefined,
  issueId: string | undefined,
  skillArg: string | undefined,
): void {
  if (subcommand !== "ack") {
    throw new Error("Usage: gxpm skill ack <issue-id> <skill> [--proof <text>]");
  }
  if (!issueId) {
    throw new Error("Usage: gxpm skill ack <issue-id> <skill> [--proof <text>]");
  }
  if (!skillArg) {
    throw new Error("Usage: gxpm skill ack <issue-id> <skill> [--proof <text>]");
  }
  runSkillAck(argv, issueId, skillArg);
}

function runSkillAck(argv: string[], issueId: string, skill: string): void {
  const state = readIssueState({ issueId });
  const phase = state.currentPhase;
  const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === phase);

  if (!rule) {
    throw new Error(
      `gxpm skill ack: phase "${phase}" is terminal and has no required skill — nothing to acknowledge for ${issueId}.`,
    );
  }
  if (rule.requiredSkill === null) {
    throw new Error(
      `gxpm skill ack: phase "${phase}" is a mechanical CLI step with no required skill (null). Nothing to acknowledge for ${issueId}.`,
    );
  }
  if (rule.requiredSkill !== skill) {
    throw new Error(
      `gxpm skill ack: skill mismatch — phase "${phase}" requires "${rule.requiredSkill}", got "${skill}". Run \`gxpm skill ack ${issueId} ${rule.requiredSkill}\`.`,
    );
  }

  const proof = optionValue(argv, "--proof") ?? undefined;
  const paths = getIssuePaths(process.cwd(), issueId);
  const now = new Date().toISOString();

  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "skill.load.satisfied",
      issueId,
      timestamp: now,
      payload: {
        phase,
        skill,
        ...(proof !== undefined ? { proof } : {}),
      },
    },
  });

  console.log(`acknowledged skill load: ${skill} for ${issueId} (phase ${phase})`);
}
