import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../../core/artifacts";
import { PHASE_GATE_RULES } from "../../core/phase-gates";
import {
  appendIssueEvent,
  getIssuePaths,
  readIssueState,
  type StateEvent,
} from "../../core/state";
import { resolveSessionId } from "../../core/session";
import { writeArtifact } from "../../core/artifacts";
import { readWorktreeOwner } from "../../core/worktree-owner";

// GXPM-188: `gxpm doctor identity` prints the current worktree's identity card
// so an agent can recover from any uncertainty. Designed to complete in
// <500ms on a normal repo. When called outside a worktree (i.e. no
// .gxpm-worktree-owner.json), prints a friendly notice and exits 0.
export function runDoctorIdentityCommand(): void {
  const cwd = process.cwd();
  const owner = readWorktreeOwner(cwd);
  if (!owner) {
    console.log("not inside an identified worktree (no .gxpm-worktree-owner.json found at cwd)");
    console.log("run `gxpm workspace ensure <issue-id>` to set up an identified worktree.");
    return;
  }

  const issueId = owner.ownerIssueId;
  let currentPhase: string | undefined;
  try {
    currentPhase = readIssueState({ issueId }).currentPhase;
  } catch {
    currentPhase = owner.currentPhase;
  }

  const rule = currentPhase ? PHASE_GATE_RULES.find((r) => r.fromPhase === currentPhase) : undefined;
  const requiredSkill = rule?.requiredSkill ?? null;

  const lastCommits = readLastCommits(cwd, 3);
  const pendingSkillLoads = readPendingSkillLoads(issueId);

  console.log(`gxpm doctor identity`);
  console.log(`  ownerIssueId:    ${issueId}`);
  console.log(`  currentPhase:    ${currentPhase ?? "(unknown)"}`);
  console.log(`  requiredSkill:   ${requiredSkill ?? "(none for this phase)"}`);
  console.log(`  branchName:      ${owner.branchName ?? "(unknown)"}`);
  console.log(`  workspacePath:   ${owner.workspacePath ?? cwd}`);
  if (lastCommits.length > 0) {
    console.log(`  recent commits:`);
    for (const c of lastCommits) console.log(`    ${c}`);
  }
  if (pendingSkillLoads.length > 0) {
    console.log(`  pending skill-load attestations:`);
    for (const s of pendingSkillLoads) console.log(`    - ${s}`);
  } else {
    console.log(`  pending skill-load attestations: (none)`);
  }
}

function readLastCommits(cwd: string, count: number): string[] {
  const result = Bun.spawnSync({
    cmd: ["git", "log", `-${count}`, "--oneline"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readPendingSkillLoads(issueId: string): string[] {
  try {
    const paths = getIssuePaths(process.cwd(), issueId);
    if (!existsSync(paths.eventsPath)) return [];
    const required = new Map<string, string>();
    const satisfied = new Set<string>();
    for (const line of readFileSync(paths.eventsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as { type?: string; payload?: { skill?: string; transitionId?: string } };
      const key = e.payload?.transitionId ?? e.payload?.skill ?? "";
      if (!key) continue;
      if (e.type === "skill.load.required") required.set(key, e.payload?.skill ?? key);
      else if (e.type === "skill.load.satisfied") satisfied.add(key);
    }
    const out: string[] = [];
    for (const [key, skill] of required) {
      if (!satisfied.has(key)) out.push(skill);
    }
    return out;
  } catch {
    return [];
  }
}

// GXPM-188: `gxpm issue handoff <id> --to-next-phase` dumps a phase-handoff
// artifact summarizing what's completed, what the next phase must read, and
// any open blockers. Used when one agent passes the issue to another (or to
// itself in a new session) at a phase boundary.
export function runIssueHandoffCommand(argv: string[], issueId: string | undefined): void {
  if (!issueId) {
    throw new Error("Usage: gxpm issue handoff <issue-id> --to-next-phase");
  }
  const wantsNextPhase = argv.includes("--to-next-phase");
  if (!wantsNextPhase) {
    throw new Error("Usage: gxpm issue handoff <issue-id> --to-next-phase");
  }

  const state = readIssueState({ issueId });
  const currentRule = PHASE_GATE_RULES.find((r) => r.fromPhase === state.currentPhase);
  const nextPhase = currentRule?.nextPhase ?? null;
  const nextRule = nextPhase
    ? PHASE_GATE_RULES.find((r) => r.fromPhase === nextPhase)
    : undefined;

  const completedAcceptance = collectCompletedAcceptance(issueId);
  const nextPhaseMustRead = collectNextPhaseMustRead(state.currentPhase, nextRule?.requiredArtifact);
  const openBlockers = collectOpenBlockers(issueId);

  const payload = {
    fromPhase: state.currentPhase,
    nextPhase,
    nextRequiredArtifact: nextRule?.requiredArtifact ?? null,
    nextRequiredSkill: nextRule?.requiredSkill ?? null,
    completedAcceptance,
    nextPhaseMustRead,
    openBlockers,
    status: "ready",
  };

  writeArtifact({ issueId, type: "phase-handoff", payload });

  const paths = getIssuePaths(process.cwd(), issueId);
  const event: StateEvent = {
    schemaVersion: 1,
    type: "phase.handoff.dumped",
    issueId,
    timestamp: new Date().toISOString(),
    sessionId: resolveSessionId(),
    payload: { fromPhase: state.currentPhase, nextPhase },
  };
  appendIssueEvent({ issueDir: paths.issueDir, event });

  console.log(`phase-handoff dumped for ${issueId}: ${state.currentPhase} -> ${nextPhase ?? "(terminal)"}`);
}

function collectCompletedAcceptance(issueId: string): Array<{ id: string; description: string }> {
  try {
    const contract = readArtifact({ issueId, type: "acceptance-contract" });
    const payload = contract.payload as { criteria?: Array<{ id?: string; description?: string; status?: string }> };
    return (payload.criteria ?? [])
      .filter((c) => c.status === "verified" || c.status === "passing" || c.status === "done")
      .map((c) => ({ id: c.id ?? "?", description: c.description ?? "" }));
  } catch {
    return [];
  }
}

function collectNextPhaseMustRead(
  currentPhase: string,
  nextRequiredArtifact: string | undefined,
): string[] {
  // Always include the upstream artifacts that the next phase typically reads.
  const upstream = ["acceptance-contract", "implementation-plan", "behavior-spec"];
  const list = [...upstream];
  if (nextRequiredArtifact && !list.includes(nextRequiredArtifact)) list.push(nextRequiredArtifact);
  return list;
}

function collectOpenBlockers(issueId: string): Array<{ source: string; message: string }> {
  const blockers: Array<{ source: string; message: string }> = [];
  // ACs that are not verified yet are blockers if we're past triage.
  try {
    const contract = readArtifact({ issueId, type: "acceptance-contract" });
    const payload = contract.payload as { criteria?: Array<{ id?: string; status?: string; description?: string }> };
    for (const c of payload.criteria ?? []) {
      if (c.status && !["verified", "passing", "done"].includes(c.status)) {
        blockers.push({ source: "acceptance-contract", message: `${c.id ?? "?"} (${c.status}): ${c.description ?? ""}` });
      }
    }
  } catch {
    // contract may not exist yet at very early phases
  }
  return blockers;
}
