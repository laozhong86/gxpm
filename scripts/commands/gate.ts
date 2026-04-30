import { existsSync, readFileSync } from "node:fs";
import { appendIssueEvent, getIssuePaths, readIssueState, transitionIssuePhase, type StateEvent } from "../../core/state";
import { hasArtifact, readArtifact } from "../../core/artifacts";
import { evaluateBranchPolicy, evaluateCommitMsg, evaluatePostMerge, evaluatePreCommit, evaluatePrePush } from "../../core/gate";
import { initializeLandFindings, reconcileLandFindings } from "../../core/land";
import { runPostLandSkillSync } from "../post-land-sync";
import { asRecord, currentGitBranch, currentGitRoot, detectCanonicalMainRoot, optionValue } from "./helpers";

export function runGateCommand(argv: string[], subcommand: string | undefined, issueId: string | undefined) {
  if (subcommand === "pre-commit") {
    runPreCommitGate(argv, issueId);
    return;
  }
  if (subcommand === "branch-policy") {
    runBranchPolicyGate(argv);
    return;
  }
  if (subcommand === "commit-msg") {
    runCommitMsgGate(argv, issueId);
    return;
  }
  if (subcommand === "pre-push") {
    runPrePushGate(issueId);
    return;
  }
  if (subcommand === "post-merge") {
    runPostMergeGate(issueId);
    return;
  }
  if (subcommand === "post-merge-reconcile") {
    runPostMergeReconcileGate(argv, issueId);
    return;
  }
  if (subcommand === "brainstorm-skip") {
    runBrainstormSkipGate(argv, issueId);
    return;
  }
  throw new Error(`Unknown command: ${["gate", subcommand].filter(Boolean).join(" ")}`);
}

function runBrainstormSkipGate(argv: string[], issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm gate brainstorm-skip <issue-id> --reason <text>");
  }
  const reason = optionValue(argv, "--reason");
  if (!reason) {
    throw new Error("Usage: gxpm gate brainstorm-skip <issue-id> --reason <text>");
  }

  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, issueId);
  const intake = readArtifact({ root: stateRoot, issueId, type: "issue-intake" });
  const payload = asRecord(intake.payload);
  const acceptance = Array.isArray(payload.acceptance) ? payload.acceptance : [];
  const antiPatterns = Array.isArray(payload.verified_pitfalls_to_avoid)
    ? payload.verified_pitfalls_to_avoid
    : [];

  const event: StateEvent = {
    schemaVersion: 1,
    type: "gate.brainstorm.skipped",
    issueId,
    timestamp: new Date().toISOString(),
    payload: {
      reason,
      intake_completeness_score: acceptance.length > 0 ? 1 : 0,
      ac_count: acceptance.length,
      anti_pattern_count: antiPatterns.length,
    },
  };

  appendIssueEvent({ issueDir: paths.issueDir, event });
  console.log(`[gxpm gate brainstorm-skip] gate.brainstorm.skipped: ${reason}`);
}

function gateEvent(verdict: { allowed: boolean; code: string; reason: string; details?: Record<string, unknown> }, gate: string, issueId: string): StateEvent {
  return {
    schemaVersion: 1,
    type: verdict.allowed ? "gate.passed" : "gate.blocked",
    issueId,
    timestamp: new Date().toISOString(),
    payload: { gate, code: verdict.code, reason: verdict.reason, ...(verdict.details ?? {}) },
  };
}

function runBranchPolicyGate(argv: string[]) {
  const currentRoot = currentGitRoot() ?? process.cwd();
  const currentBranch = optionValue(argv, "--branch") ?? currentGitBranch();
  const canonicalMainRoot =
    optionValue(argv, "--canonical-main") ??
    process.env.GXPM_CANONICAL_MAIN ??
    detectCanonicalMainRoot() ??
    currentRoot;
  const allowedWorktreeRoot = optionValue(argv, "--worktree-root") ?? process.env.GXPM_WORKTREE_ROOT ?? undefined;
  const verdict = evaluateBranchPolicy({
    currentRoot,
    currentBranch,
    canonicalMainRoot,
    allowedWorktreeRoot,
    env: process.env,
  });

  if (!verdict.allowed) {
    console.error(`[gxpm gate branch-policy] ${verdict.code}: ${verdict.reason}`);
    console.error("Use a dedicated git worktree for feature branches; keep the canonical checkout on main.");
    console.error("Escape: GXPM_GATE_DISABLE=1 git ...");
    process.exit(1);
  }

  console.log(`[gxpm gate branch-policy] ${verdict.code}: ${verdict.reason}`);
}

function runPreCommitGate(argv: string[], issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm gate pre-commit <issue-id> --staged <files...>");
  }
  const dashStaged = argv.indexOf("--staged");
  const stagedFiles = dashStaged >= 0 ? argv.slice(dashStaged + 1) : [];

  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, issueId);
  if (!existsSync(paths.statePath)) {
    console.log(`no-state: ${issueId} not tracked by gxpm`);
    return;
  }

  const state = readIssueState({ root: stateRoot, issueId });
  const verdict = evaluatePreCommit(state, stagedFiles, process.env);
  appendIssueEvent({ issueDir: paths.issueDir, event: gateEvent(verdict, "pre-commit", issueId) });

  if (!verdict.allowed) {
    console.error(`[gxpm gate pre-commit] ${verdict.code}: ${verdict.reason}`);
    const hits = verdict.details?.protectedHits;
    if (Array.isArray(hits)) {
      for (const f of hits) console.error(`  - ${f}`);
    }
    console.error("Escape: GXPM_GATE_DISABLE=1 git commit ...");
    process.exit(1);
  }
  console.log(`[gxpm gate pre-commit] ${verdict.code}: ${verdict.reason}`);
}

function runCommitMsgGate(argv: string[], firstArg: string | undefined) {
  const msgFile = firstArg;
  if (!msgFile) {
    throw new Error("Usage: gxpm gate commit-msg <msg-file> [--issue <id>]");
  }
  const dashIssue = argv.indexOf("--issue");
  const explicitIssue = dashIssue >= 0 ? argv[dashIssue + 1] : null;
  const message = readFileSync(msgFile, "utf8");

  const inferred =
    explicitIssue ??
    (message.match(/\b(GXG|GXPM)-\d+\b/i)?.[0]?.toUpperCase() ?? null);
  if (!inferred) {
    console.error(
      "[gxpm gate commit-msg] missing-issue-ref: commit message must reference GXG-NNN or GXPM-NNN",
    );
    process.exit(1);
  }

  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, inferred);
  if (!existsSync(paths.statePath)) {
    console.log(`no-state: ${inferred} not tracked by gxpm`);
    return;
  }

  const state = readIssueState({ root: stateRoot, issueId: inferred });
  const verdict = evaluateCommitMsg(message, state, process.env);
  if (!verdict.allowed) {
    console.error(`[gxpm gate commit-msg] ${verdict.code}: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`[gxpm gate commit-msg] ${verdict.code}: ${verdict.reason}`);
}

function runPrePushGate(issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm gate pre-push <issue-id>");
  }
  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, issueId);
  if (!existsSync(paths.statePath)) {
    console.log(`no-state: ${issueId} not tracked by gxpm`);
    return;
  }

  const state = readIssueState({ root: stateRoot, issueId });
  const verdict = evaluatePrePush(
    state,
    (id, t) => hasArtifact({ root: stateRoot, issueId: id, type: t }),
    process.env,
  );
  if (!verdict.allowed) {
    console.error(`[gxpm gate pre-push] ${verdict.code}: ${verdict.reason}`);
    if (verdict.details && typeof verdict.details.command === "string") {
      console.error(
        `Hint: ${verdict.details.command.replace("<issue-id>", issueId)}`,
      );
    }
    process.exit(1);
  }
  console.log(`[gxpm gate pre-push] ${verdict.code}: ${verdict.reason}`);
}

function runPostMergeGate(issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm gate post-merge <issue-id>");
  }
  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, issueId);
  if (!existsSync(paths.statePath)) {
    console.log(`no-state: ${issueId} not tracked by gxpm`);
    return;
  }

  const state = readIssueState({ root: stateRoot, issueId });
  const outcome = evaluatePostMerge(state);
  if (!outcome.transitionTo) {
    console.log(`[gxpm gate post-merge] ${outcome.reason}`);
    return;
  }

  // Auto-initialize the gate artifact before transitioning so the merge always
  // produces a complete trail. Idempotent: writeArtifact overwrites existing files.
  if (outcome.transitionTo === "land" && !hasArtifact({ root: stateRoot, issueId, type: "land-findings" })) {
    initializeLandFindings({ root: stateRoot, issueId });
  }

  const updated = transitionIssuePhase({ root: stateRoot, issueId, nextPhase: outcome.transitionTo });
  console.log(`transitioned ${issueId}: ${state.currentPhase} -> ${updated.currentPhase}`);
  if (updated.currentPhase === "land") {
    console.log(`Hint: gxpm cleanup land ${issueId} --execute  # 清理 worktree + local branch`);
    const sync = runPostLandSkillSync({ env: process.env });
    if (!sync.ok) {
      console.error(`[gxpm land sync] ${sync.message}`);
    }
  }
}

function runPostMergeReconcileGate(argv: string[], issueId: string | undefined) {
  if (!issueId) {
    throw new Error("Usage: gxpm gate post-merge-reconcile <issue-id> --sha <sha>");
  }
  const sha = optionValue(argv, "--sha");
  if (!sha) {
    throw new Error("Usage: gxpm gate post-merge-reconcile <issue-id> --sha <sha>");
  }

  const stateRoot = process.cwd();
  const paths = getIssuePaths(stateRoot, issueId);
  if (!existsSync(paths.statePath)) {
    console.log(`no-state: ${issueId} not tracked by gxpm`);
    return;
  }

  const state = readIssueState({ root: stateRoot, issueId });
  if (state.currentPhase !== "land") {
    console.log(`[gxpm gate post-merge-reconcile] phase=${state.currentPhase} is not land`);
    return;
  }
  if (!hasArtifact({ root: stateRoot, issueId, type: "land-findings" })) {
    console.log("[gxpm gate post-merge-reconcile] land-findings artifact missing");
    return;
  }
  if (!gitCommitExists(stateRoot, sha)) {
    throw new Error(`Git commit not found for post-merge reconcile: ${sha}`);
  }

  const result = reconcileLandFindings({ root: stateRoot, issueId, sha });
  if (result.reconciled) {
    console.log(`[gxpm gate post-merge-reconcile] reconciled land-findings for ${issueId}`);
    return;
  }
  console.log(`[gxpm gate post-merge-reconcile] ${result.reason}`);
}

function gitCommitExists(cwd: string, sha: string) {
  const result = Bun.spawnSync({
    cmd: ["git", "cat-file", "-e", `${sha}^{commit}`],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}
