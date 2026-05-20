import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createIssueState,
  getIssuePaths,
  isIssueType,
  ISSUE_TYPES,
  readIssueState,
  setIssueArchived,
  transitionIssuePhase,
  type IssueType,
  type StateEvent,
} from "../../core/state";
import { readSyncState } from "../../core/issue-sync";
import { hasArtifact } from "../../core/artifacts";
import { readResumePacket, writeIssueCheckpoint } from "../../core/checkpoint";
import { buildIssueContext } from "../../core/issue-context";
import { getNextAvailableIssueId, listIssues, recentLandedIssues } from "../../core/issues";
import { PHASE_GATE_RULES } from "../../core/phase-gates";
import {
  claimIssue,
  listIssueReadiness,
  listReadyIssues,
  reconcileIssueClaim,
  releaseIssueClaim,
} from "../../core/issue-readiness";
import { runPostLandSkillSync } from "../post-land-sync";
import { ensureIssueWorkspaceWithResolver } from "../../core/workspace-runtime";
import { readArtifact, writeArtifact } from "../../core/artifacts";
import { currentGitBranch, detectCanonicalMainRoot, currentGitRoot, optionRequiredValue, optionValue, parsePositiveIntegerOption, payloadTitle, readJsonPayloadFromArgs } from "./helpers";
import { getResolvedConfigValue } from "../../core/config";
import { readWorktreeOwner, writeWorktreeOwnerMarker, writeIssueContextMd } from "../../core/worktree-owner";

const ISSUE_TYPE_USAGE = ISSUE_TYPES.join("|");
const ISSUE_TYPE_LIST = formatList(ISSUE_TYPES);
const ISSUE_CREATE_USAGE = `Usage: gxpm issue create <issue-id>  (or --auto-id) [--type ${ISSUE_TYPE_USAGE}] [--parent <parent-issue-id>]`;

export async function runIssueCommand(argv: string[], subcommand: string | undefined, issueId: string | undefined, value: string | undefined) {
  if (subcommand === "create") {
    const resolvedId = resolveIssueCreateId(argv);
    const issueType = parseIssueTypeOption(argv, "feature");
    const parentId = parseParentOption(argv);
    let state = createIssueState({ issueId: resolvedId, issueType });
    if (parentId) {
      state = addIssueRelation({ childId: resolvedId, parentId });
      console.log(`parent: ${parentId}`);
    }
    console.log(`created ${state.issueId} at ${state.currentPhase}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), resolvedId).statePath}`);
    return;
  }

  if (subcommand === "status") {
    if (!issueId) throw new Error("Usage: gxpm issue status <issue-id>");
    const state = readIssueState({ issueId });
    console.log(`issueId: ${state.issueId}`);
    console.log(`currentPhase: ${state.currentPhase}`);
    console.log(`updatedAt: ${state.updatedAt}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
    if (state.creator) {
      console.log(`creator: ${state.creator.actor} (${state.creator.host})`);
    }
    if (state.claim?.status === "claimed") {
      console.log(`assignee: ${state.claim.actor} (${state.claim.claimedBySession.split(":")[0] ?? "unknown"})`);
    }
    // GXPM-159: show relations summary so agents can discover batch/epic boundaries
    const relations = state.relations ?? [];
    if (relations.length > 0) {
      const grouped: Record<string, string[]> = { parent: [], child: [], related: [] };
      for (const r of relations) {
        (grouped[r.relation] ?? []).push(r.issueId);
      }
      for (const kind of ["parent", "child", "related"] as const) {
        if (grouped[kind].length > 0) {
          console.log(`${kind}: ${grouped[kind].join(", ")}`);
        }
      }
    }
    const syncState = readSyncState({ issueId });
    if (syncState.targets.length > 0) {
      for (const target of syncState.targets) {
        const syncStatus = target.lastError ? `error: ${target.lastError.message}` : `synced at ${target.syncedAt ?? "unknown"}`;
        console.log(`external: ${target.provider} ${target.displayId} (${target.url}) — ${syncStatus}`);
      }
    }
    return;
  }

  if (subcommand === "link") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue link <source-id> (--parent <target-id> | --related <target-id>)");
    }
    const parentTarget = argv.includes("--parent") ? optionRequiredValue(argv, "--parent") : undefined;
    const relatedTarget = argv.includes("--related") ? optionRequiredValue(argv, "--related") : undefined;
    if (parentTarget && relatedTarget) {
      throw new Error("gxpm issue link: --parent and --related are mutually exclusive");
    }
    if (!parentTarget && !relatedTarget) {
      throw new Error("gxpm issue link: must specify --parent <id> or --related <id>");
    }
    if (parentTarget) {
      linkIssues({ sourceId: issueId, targetId: parentTarget, kind: "parent" });
      console.log(`linked ${issueId} --parent--> ${parentTarget}`);
    } else if (relatedTarget) {
      linkIssues({ sourceId: issueId, targetId: relatedTarget, kind: "related" });
      console.log(`linked ${issueId} <--related--> ${relatedTarget}`);
    }
    return;
  }

  if (subcommand === "list") {
    const json = argv.includes("--json");
    const includeAll = argv.includes("--all");
    const archivedOnly = argv.includes("--archived");
    const types = parseIssueTypesOption(argv);
    const limit = parsePositiveIntegerOption(argv, "--limit");
    const recentIdx = argv.indexOf("--recent");
    const recentN = recentIdx >= 0 ? parseInt(argv[recentIdx + 1] ?? "5", 10) || 5 : 0;
    let entries: ReturnType<typeof listIssues>;
    if (recentN > 0) {
      if (types || limit !== undefined) {
        throw new Error("gxpm issue list --recent cannot be combined with --type or --limit");
      }
      entries = recentLandedIssues({ limit: recentN });
    } else {
      entries = listIssues({ includeAll, archivedOnly, types, limit });
    }
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      const hint = includeAll
        ? "no issues tracked under .gxpm/issues/"
        : "no active issues (use 'gxpm issue list --all' to include landed/archived)";
      console.log(hint);
      return;
    }
    const idWidth = Math.max(8, ...entries.map((e) => e.issueId.length));
    const typeWidth = Math.max(7, ...entries.map((e) => e.issueType.length));
    const phaseWidth = Math.max(13, ...entries.map((e) => e.currentPhase.length));
    console.log(`${"ISSUE".padEnd(idWidth)}  ${"TYPE".padEnd(typeWidth)}  ${"PHASE".padEnd(phaseWidth)}  UPDATED                   FLAGS`);
    for (const entry of entries) {
      let flags = entry.archived ? "archived" : "";
      try {
        const st = readIssueState({ issueId: entry.issueId });
        const hasParent = st.relations?.some((r) => r.relation === "parent");
        const hasChild = st.relations?.some((r) => r.relation === "child");
        const relFlags = [hasParent ? "has-parent" : "", hasChild ? "has-child" : ""].filter(Boolean).join(",");
        if (relFlags) {
          flags = flags ? `${flags},${relFlags}` : relFlags;
        }
      } catch {
        // ignore
      }
      console.log(
        `${entry.issueId.padEnd(idWidth)}  ${entry.issueType.padEnd(typeWidth)}  ${entry.currentPhase.padEnd(phaseWidth)}  ${entry.updatedAt}  ${flags}`,
      );
    }
    return;
  }

  if (subcommand === "ready") {
    runIssueReady(argv);
    return;
  }

  if (subcommand === "claim") {
    runIssueClaim(argv, issueId);
    return;
  }

  if (subcommand === "release") {
    runIssueRelease(argv, issueId);
    return;
  }

  if (subcommand === "reconcile-claim") {
    runIssueReconcileClaim(argv, issueId);
    return;
  }

  if (subcommand === "archive" || subcommand === "unarchive") {
    if (!issueId) throw new Error(`Usage: gxpm issue ${subcommand} <issue-id>`);
    setIssueArchived({ issueId, archived: subcommand === "archive" });
    console.log(`${subcommand === "archive" ? "archived" : "unarchived"} ${issueId}`);
    return;
  }

  if (subcommand === "next") {
    if (!issueId) throw new Error("Usage: gxpm issue next <issue-id>");
    runIssueNext(issueId);
    return;
  }

  if (subcommand === "checkpoint") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue checkpoint <issue-id> --title <title> --json <json> | --from <file> | --stdin");
    }
    runIssueCheckpoint(argv, issueId);
    return;
  }

  if (subcommand === "resume") {
    if (!issueId) throw new Error("Usage: gxpm issue resume <issue-id>");
    runIssueResume(issueId);
    return;
  }

  if (subcommand === "batch") {
    if (!issueId) throw new Error("Usage: gxpm issue batch <issue-id>");
    runIssueBatch(issueId);
    return;
  }

  if (subcommand === "history") {
    if (!issueId) throw new Error("Usage: gxpm issue history <issue-id> [--json]");
    runIssueHistory(issueId, argv.includes("--json"));
    return;
  }

  if (subcommand === "ownership") {
    if (!issueId) throw new Error("Usage: gxpm issue ownership <issue-id> [--field <name>] [--history-contains <session-id>]");
    runIssueOwnership(argv, issueId);
    return;
  }

  if (subcommand === "context") {
    const asJson = argv.includes("--json");
    if (argv.includes("--auto")) {
      runIssueContext("--auto", asJson);
      return;
    }
    if (!issueId) throw new Error("Usage: gxpm issue context <issue-id> [--json]");
    runIssueContext(issueId, asJson);
    return;
  }

  if (subcommand === "transition") {
    if (!issueId || !value) throw new Error("Usage: gxpm issue transition <issue-id> <phase>");
    const before = readIssueState({ issueId });
    const after = transitionIssuePhase({ issueId, nextPhase: value, skipCleanup: argv.includes("--skip-cleanup") });

    // Auto-ensure worktree on dispatch -> specify transition
    if (before.currentPhase === "dispatch" && after.currentPhase === "specify") {
      try {
        // Build linkedIssues from relations so child issues reuse parent worktree
        const linkedIssues = (before.relations ?? []).map((r) => r.issueId);
        const result = await ensureIssueWorkspaceWithResolver({ issueId, existingEnvId: issueId, hints: linkedIssues.length > 0 ? { linkedIssues } : undefined });
        if (result.resolution?.status === "resolved" && result.resolution.env) {
          const handoff = readArtifact({ issueId, type: "dispatch-handoff" });
          writeArtifact({
            issueId,
            type: "dispatch-handoff",
            payload: {
              ...(handoff.payload as Record<string, unknown>),
              worktreePath: result.resolution.env.workspacePath,
              worktreeDecision: result.method?.type === "created" ? "created" : "reused",
            },
          });
          // Write enhanced worktree ownership marker + passive context recovery file
          const allLinked = [issueId, ...linkedIssues];
          try {
            writeWorktreeOwnerMarker(result.workspacePath, {
              ownerIssueId: issueId,
              linkedIssues: allLinked,
              currentPhase: after.currentPhase,
              branchName: result.resolution.env.branchName,
              workspacePath: result.resolution.env.workspacePath,
            });
            writeIssueContextMd(result.workspacePath, {
              issueId,
              currentPhase: after.currentPhase,
              branchName: result.resolution.env.branchName,
              workspacePath: result.resolution.env.workspacePath,
              updatedAt: new Date().toISOString(),
            });
          } catch {
            // best-effort; marker is advisory
          }
          console.log(`worktree: ${result.workspacePath}`);
          if (result.resolution.env.branchName) {
            console.log(`branch:   ${result.resolution.env.branchName}`);
          }
          if (result.warnings) {
            for (const warning of result.warnings) {
              console.log(`warning:  ${warning}`);
            }
          }
        } else if (result.resolution?.status === "blocked" && result.userMessage) {
          console.error(`worktree blocked: ${result.userMessage}`);
        }
      } catch (worktreeError) {
        const message = worktreeError instanceof Error ? worktreeError.message : String(worktreeError);
        console.error(`worktree ensure failed: ${message}`);
      }
    }

    // Refresh passive context recovery files on any transition while in a worktree
    refreshWorktreeContextFiles(after.issueId, after.currentPhase);

    console.log(`transitioned ${after.issueId}: ${before.currentPhase} -> ${after.currentPhase}`);
    if (after.currentPhase === "land") {
      const sync = runPostLandSkillSync({ env: process.env });
      if (!sync.ok) console.error(`[gxpm land sync] ${sync.message}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${["issue", subcommand].filter(Boolean).join(" ")}`);
}

function runIssueHistory(issueId: string, asJson: boolean) {
  const paths = getIssuePaths(process.cwd(), issueId);
  if (!existsSync(paths.eventsPath)) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const lines = readFileSync(paths.eventsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const events = lines.map((line) => JSON.parse(line) as StateEvent);

  if (asJson) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  console.log(`${issueId} timeline (${events.length} event${events.length === 1 ? "" : "s"})`);
  console.log("─".repeat(60));

  for (const event of events) {
    const ts = event.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
    const type = event.type.padEnd(20);
    const detail = formatEventDetail(event);
    console.log(`${ts}  ${type}  ${detail}`);
  }
}

function formatEventDetail(event: StateEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "issue.created":
      return `phase: ${p.initialPhase ?? "?"}`;
    case "phase.transitioned":
      return `${p.fromPhase ?? "?"} → ${p.toPhase ?? "?"}`;
    case "artifact.written":
      return `${p.artifactType ?? "?"} (${p.path ?? ""})`;
    case "artifact.reconciled":
      return `${p.artifactType ?? "?"} (${p.mergedSha ?? ""})`;
    case "checkpoint.written":
      return `${p.checkpointPath ?? "?"} (${p.resumePacketPath ?? ""})`;
    case "gate.passed":
      if (p.gate) return `${p.gate} (${p.code ?? ""})`;
      return `${p.fromPhase ?? "?"} → ${p.toPhase ?? "?"} (${p.requiredArtifact ?? ""})`;
    case "gate.blocked":
      if (p.gate) return `${p.gate}: ${p.reason ?? ""}`;
      return `${p.fromPhase ?? "?"} → ${p.toPhase ?? "?"} blocked: ${p.missingArtifact ?? ""}`;
    case "issue.claimed":
      return `${p.actor ?? "?"} by ${p.claimedBySession ?? "?"}`;
    case "issue.claim.released":
      return `${p.releaseReason ?? "released"} by ${p.releasedBySession ?? "?"}`;
    case "issue.claim.stale":
      return `${p.staleReason ?? "stale"} since ${p.staleAt ?? "?"}`;
    case "ownership.changed":
      return `${p.fromSession ?? "?"} → ${p.toSession ?? "?"}`;
    default:
      return JSON.stringify(p);
  }
}

function runIssueReady(argv: string[]) {
  const includeAll = argv.includes("--all");
  const issues = includeAll ? listIssueReadiness({ includeAll: true }) : listReadyIssues();
  if (argv.includes("--json")) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }
  if (issues.length === 0) {
    console.log(includeAll ? "no issues tracked" : "no ready issues");
    return;
  }
  const issueWidth = Math.max("ISSUE".length, ...issues.map((issue) => issue.issueId.length));
  const phaseWidth = Math.max("PHASE".length, ...issues.map((issue) => issue.currentPhase.length));
  const decisionWidth = Math.max("DECISION".length, ...issues.map((issue) => issue.decision.length));
  console.log(
    `${"ISSUE".padEnd(issueWidth)}  ${"PHASE".padEnd(phaseWidth)}  ${"DECISION".padEnd(decisionWidth)}  REASON`,
  );
  for (const issue of issues) {
    console.log(
      `${issue.issueId.padEnd(issueWidth)}  ${issue.currentPhase.padEnd(phaseWidth)}  ${issue.decision.padEnd(decisionWidth)}  ${issue.reason}`,
    );
  }
}

function runIssueClaim(argv: string[], issueId: string | undefined) {
  const useNext = argv.includes("--next");
  if (useNext && issueId && !issueId.startsWith("--")) {
    throw new Error("Usage: choose either `gxpm issue claim <issue-id>` or `gxpm issue claim --next`");
  }
  const actor = argv.includes("--actor") ? optionRequiredValue(argv, "--actor") : undefined;
  const runId = argv.includes("--run") ? optionRequiredValue(argv, "--run") : undefined;
  const targetIssueId = useNext ? listReadyIssues()[0]?.issueId : issueId;
  if (useNext && !targetIssueId) {
    throw new Error("No ready issues to claim");
  }
  if (!targetIssueId || targetIssueId.startsWith("--")) {
    throw new Error("Usage: gxpm issue claim <issue-id> [--actor <name>] [--run <run-id>] [--json] | gxpm issue claim --next [--actor <name>] [--run <run-id>] [--json]");
  }
  const result = claimIssue({
    issueId: targetIssueId,
    actor,
    runId,
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.claimed ? "claimed" : "already claimed"} ${result.issueId}`);
  console.log(`actor: ${result.claim.actor}`);
  console.log(`session: ${result.claim.claimedBySession}`);
  if (result.claim.runId) console.log(`runId: ${result.claim.runId}`);
}

function runIssueRelease(argv: string[], issueId: string | undefined) {
  if (!issueId || issueId.startsWith("-")) {
    throw new Error("Usage: gxpm issue release <issue-id> [--reason <text>] [--json]");
  }
  const reason = argv.includes("--reason") ? optionRequiredValue(argv, "--reason") : undefined;
  const result = releaseIssueClaim({
    issueId,
    reason,
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.released ? "released" : "already released"} ${result.issueId}`);
  console.log(`reason: ${result.claim.status === "released" ? result.claim.releaseReason : "already_released"}`);
}

function runIssueReconcileClaim(argv: string[], issueId: string | undefined) {
  if (!issueId || issueId.startsWith("-")) {
    throw new Error("Usage: gxpm issue reconcile-claim <issue-id> [--stale-after-ms N] [--json]");
  }
  const result = reconcileIssueClaim({
    issueId,
    staleAfterMs: parsePositiveIntegerOption(argv, "--stale-after-ms"),
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.reconciled ? "reconciled" : "unchanged"} ${result.issueId}`);
  console.log(`action: ${result.action}`);
  console.log(`reason: ${result.reason}`);
}

function runIssueOwnership(argv: string[], issueId: string) {
  const state = readIssueState({ issueId });
  const ownership = state.ownership;
  const field = optionValue(argv, "--field");
  const historyContains = optionValue(argv, "--history-contains");

  if (historyContains) {
    process.exit(ownership?.history.some((entry) => entry.sessionId === historyContains) ? 0 : 1);
  }

  if (field) {
    if (field === "currentSession") {
      console.log(ownership?.currentSession ?? "");
      return;
    }
    if (field === "history") {
      console.log(JSON.stringify(ownership?.history ?? []));
      return;
    }
    throw new Error(`Unknown ownership field: ${field}`);
  }

  console.log(`issueId: ${state.issueId}`);
  console.log(`currentSession: ${ownership?.currentSession ?? ""}`);
  console.log("history:");
  console.log("session\tfirstTouch\tlastTouch");
  for (const entry of ownership?.history ?? []) {
    console.log(`${entry.sessionId}\t${entry.firstTouch}\t${entry.lastTouch}`);
  }
}

function runIssueNext(issueId: string) {
  const state = readIssueState({ issueId });
  console.log(`${issueId}  currentPhase: ${state.currentPhase}`);

  const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === state.currentPhase);
  if (!rule) {
    console.log("");
    console.log(`Phase ${state.currentPhase} is terminal — no further transition.`);
    if (state.currentPhase === "land") {
      console.log("This issue has landed. Mark as Done in upstream issue tracker.");
    }
    return;
  }

  const has = hasArtifact({ issueId, type: rule.requiredArtifact });
  console.log("");

  // Worktree advisory: when in dispatch on canonical main checkout with a feature branch, warn early
  if (state.currentPhase === "dispatch") {
    const branch = currentGitBranch();
    const baseBranch = getResolvedConfigValue({ key: "worktree.baseBranch" }).value as string;
    if (branch && branch !== baseBranch) {
      const canonicalRoot = detectCanonicalMainRoot();
      const currentRoot = currentGitRoot();
      if (canonicalRoot && currentRoot && currentRoot === canonicalRoot) {
        console.log(`WARNING: You are on a feature branch in the canonical ${baseBranch} checkout.`);
        console.log("         gxpm requires feature branches to run in a dedicated git worktree.");
        console.log(`         Run: gxpm workspace ensure ${issueId}`);
        console.log("");
      }
    }
  }

  // Phase command reference for agent clarity
  console.log(`Available commands for ${state.currentPhase}:`);
  console.log(`  init:    ${rule.command.replace("<issue-id>", issueId)}`);
  console.log(`  write:   gxpm artifact write ${issueId} ${rule.requiredArtifact} --json '...'`);
  console.log(`  edit:    gxpm artifact edit ${issueId} ${rule.requiredArtifact}`);
  console.log(`  transition: gxpm issue transition ${issueId} ${rule.nextPhase}`);
  console.log("");

  if (!has) {
    console.log(`Next: ${rule.command.replace("<issue-id>", issueId)}`);
    console.log(`      → creates draft of artifact: ${rule.requiredArtifact}`);
    console.log("");
    console.log(`Then: edit the artifact (or use 'gxpm artifact write ${issueId} ${rule.requiredArtifact} --json ...')`);
    console.log(`Then: gxpm issue transition ${issueId} ${rule.nextPhase}`);
  } else {
    console.log(`Artifact ${rule.requiredArtifact} already exists.`);
    // Worktree advisory: when dispatch-handoff exists but worktree is still pending
    if (state.currentPhase === "dispatch") {
      try {
        const handoff = readArtifact({ issueId, type: "dispatch-handoff" });
        const decision = (handoff.payload as Record<string, unknown>)?.worktreeDecision;
        if (decision === "pending") {
          console.log(`Next: gxpm workspace ensure ${issueId}`);
          console.log("      → prepares the git worktree before implementation");
          console.log("");
        }
      } catch {
        // ignore missing dispatch-handoff
      }
    }
    console.log(`Next: gxpm issue transition ${issueId} ${rule.nextPhase}`);
  }
}

function runIssueCheckpoint(argv: string[], issueId: string) {
  const payload = readJsonPayloadFromArgs(argv, "gxpm issue checkpoint");
  const title = optionValue(argv, "--title") ?? payloadTitle(payload) ?? "checkpoint";
  const reason = optionValue(argv, "--reason");
  if (reason && payload && typeof payload === "object") {
    (payload as Record<string, unknown>).transitionReason = reason;
  }
  const record = writeIssueCheckpoint({
    issueId,
    title,
    branch: currentGitBranch(),
    payload,
  });
  // Refresh passive context recovery files so the agent can recover after context compaction
  try {
    const state = readIssueState({ issueId });
    refreshWorktreeContextFiles(issueId, state.currentPhase, title);
  } catch {
    // best-effort
  }
  console.log(`checkpoint saved for ${issueId}`);
  console.log(`file: ${record.path}`);
  console.log(`resume: ${record.resumePacketPath}`);
}

function refreshWorktreeContextFiles(issueId: string, currentPhase: string, title?: string) {
  // Try to locate the worktree path from multiple sources
  let workspacePath: string | undefined;

  // 1. Check current directory first
  const cwd = process.cwd();
  const owner = readWorktreeOwner(cwd);
  if (owner && (owner.ownerIssueId === issueId || owner.linkedIssues.includes(issueId))) {
    workspacePath = owner.workspacePath ?? cwd;
  }

  // 2. Fall back to dispatch-handoff artifact worktreePath
  if (!workspacePath) {
    try {
      const handoff = readArtifact({ issueId, type: "dispatch-handoff" });
      const payload = (handoff.payload ?? {}) as Record<string, unknown>;
      const candidate =
        (payload.worktreePath as string) ??
        (payload.workspace as string) ??
        (payload.worktree as string);
      if (candidate && typeof candidate === "string") {
        workspacePath = candidate;
      }
    } catch {
      // no dispatch-handoff
    }
  }

  if (!workspacePath) return;

  // Read existing owner from the worktree to preserve createdAt / linkedIssues
  const existingOwner = readWorktreeOwner(workspacePath);
  const linkedIssues = existingOwner?.linkedIssues ?? [issueId];
  const createdAt = existingOwner?.createdAt ?? new Date().toISOString();

  const phaseOrder = [
    "triage", "plan", "dispatch", "specify", "implement",
    "local-verify", "ac-check", "self-review", "ship",
    "pr-check", "verify", "qa", "land",
  ] as const;
  const idx = phaseOrder.indexOf(currentPhase as (typeof phaseOrder)[number]);
  const nextPhase = idx >= 0 && idx < phaseOrder.length - 1 ? phaseOrder[idx + 1] : undefined;

  try {
    writeWorktreeOwnerMarker(workspacePath, {
      ownerIssueId: existingOwner?.ownerIssueId ?? issueId,
      linkedIssues,
      createdAt,
      currentPhase,
      title: title ?? existingOwner?.title,
      updatedAt: new Date().toISOString(),
      branchName: existingOwner?.branchName ?? currentGitBranch(),
      workspacePath,
    });
    writeIssueContextMd(workspacePath, {
      issueId: existingOwner?.ownerIssueId ?? issueId,
      currentPhase,
      title: title ?? existingOwner?.title,
      nextPhase,
      branchName: existingOwner?.branchName ?? currentGitBranch(),
      workspacePath,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // best-effort
  }
}

function runIssueResume(issueId: string) {
  const packet = readResumePacket({ issueId });
  console.log(`${issueId} resume packet`);
  console.log(`phase: ${packet.phase}`);
  console.log(`status: ${packet.status}`);
  console.log(`title: ${packet.title}`);
  console.log(`branch: ${packet.branch}`);
  console.log(`saved: ${packet.writtenAt}`);
  console.log(`checkpoint: ${packet.checkpointPath}`);
  if (packet.parentCheckpointId) {
    console.log(`parent: ${packet.parentCheckpointId}`);
  }
  if (packet.transitionReason) {
    console.log(`reason: ${packet.transitionReason}`);
  }
  console.log("");
  console.log("Summary:");
  console.log(packet.summary);
  console.log("");
  console.log("Remaining Work:");
  if (packet.remainingWork.length === 0) {
    console.log("1. none");
  } else {
    packet.remainingWork.forEach((item, index) => console.log(`${index + 1}. ${item}`));
  }
  console.log("");
  console.log("Notes:");
  if (packet.notes.length === 0) {
    console.log("- none");
  } else {
    packet.notes.forEach((item) => console.log(`- ${item}`));
  }
  console.log("");
  console.log(`Next: gxpm issue next ${issueId}`);
}

function runIssueContext(issueId: string, asJson: boolean) {
  let resolvedId = issueId;
  if (issueId === "--auto") {
    const owner = readWorktreeOwner(process.cwd());
    if (!owner) {
      const msg = "No .gxpm-worktree-owner.json found in current directory. Are you in a worktree?";
      if (asJson) {
        console.log(JSON.stringify({ error: msg }, null, 2));
      } else {
        console.error(msg);
      }
      process.exit(1);
    }
    resolvedId = owner.ownerIssueId;
    if (!asJson) {
      console.log(`(auto-resolved from worktree owner: ${resolvedId})\n`);
    }
  }
  const context = buildIssueContext({ issueId: resolvedId });

  if (asJson) {
    console.log(JSON.stringify(context, null, 2));
    return;
  }

  console.log(`issueId: ${context.issueId}`);
  console.log(`currentPhase: ${context.currentPhase}`);
  if (context.title) {
    console.log(`title: ${context.title}`);
  }
  console.log(`confidence: ${context.confidence}`);
  console.log("");
  console.log("Confidence reasons:");
  for (const reason of context.confidenceReasons) {
    console.log(`- ${reason}`);
  }
  if (context.resumePhase) {
    console.log("");
    console.log(`resumePhase: ${context.resumePhase}`);
    console.log(`resumeWrittenAt: ${context.resumeWrittenAt ?? "n/a"}`);
    console.log(`checkpointExists: ${context.checkpointExists}`);
  }
  console.log("");
  console.log("Required reads:");
  for (const path of context.requiredReads) {
    console.log(`- ${path}`);
  }
  console.log("");
  console.log("Agent instructions:");
  for (const instruction of context.agentInstructions) {
    console.log(`- ${instruction}`);
  }
  console.log("");
  console.log(`Next: ${context.next}`);
}

function resolveIssueCreateId(argv: string[]) {
  const args = argv.slice(2);
  const hasAutoId = args.includes("--auto-id");
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--auto-id") continue;
    if (arg === "--type") {
      index += 1;
      continue;
    }
    if (arg === "--parent") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option for gxpm issue create: ${arg}`);
    }
    positional.push(arg);
  }

  if (hasAutoId && positional.length > 0) {
    throw new Error(ISSUE_CREATE_USAGE);
  }
  if (positional.length > 1) {
    throw new Error(ISSUE_CREATE_USAGE);
  }
  if (positional[0]) return positional[0];
  if (hasAutoId) return getNextAvailableIssueId();
  throw new Error(ISSUE_CREATE_USAGE);
}

function parseParentOption(argv: string[]): string | undefined {
  if (!argv.includes("--parent")) return undefined;
  return optionRequiredValue(argv, "--parent");
}

function addIssueRelation(input: { childId: string; parentId: string }) {
  return linkIssues({ sourceId: input.childId, targetId: input.parentId, kind: "parent", root: process.cwd() });
}

/**
 * GXPM-159: General-purpose post-hoc issue linking.
 * - kind === "parent": writes child→parent and parent→child
 * - kind === "related": writes a→related→b and b→related→a (symmetric)
 *
 * Validates: existence of both issues, no self-links, no duplicate relations.
 */
function linkIssues(input: { sourceId: string; targetId: string; kind: "parent" | "related"; root?: string }) {
  if (input.sourceId === input.targetId) {
    throw new Error(`gxpm issue link: cannot link to self (${input.sourceId})`);
  }
  const root = input.root ?? process.cwd();
  const now = new Date().toISOString();

  // Validate existence (readIssueState throws if missing)
  let sourceState;
  try {
    sourceState = readIssueState({ root, issueId: input.sourceId });
  } catch {
    throw new Error(`gxpm issue link: issue not found: ${input.sourceId}`);
  }
  let targetState;
  try {
    targetState = readIssueState({ root, issueId: input.targetId });
  } catch {
    throw new Error(`gxpm issue link: issue not found: ${input.targetId}`);
  }

  // Determine relation labels for each side
  const sourceLabel = input.kind === "parent" ? "parent" : "related";
  const targetLabel = input.kind === "parent" ? "child" : "related";

  // Duplicate check (on the source side; symmetry implies same outcome on target)
  const existing = (sourceState.relations ?? []).find(
    (r) => r.relation === sourceLabel && r.issueId === input.targetId,
  );
  if (existing) {
    throw new Error(
      `gxpm issue link: relation already exists: ${input.sourceId} --${sourceLabel}--> ${input.targetId}`,
    );
  }

  // Write source side
  const sourceRelations = [
    ...(sourceState.relations ?? []),
    { relation: sourceLabel, issueId: input.targetId, createdAt: now },
  ];
  const sourcePaths = getIssuePaths(root, input.sourceId);
  const sourceRaw = JSON.parse(readFileSync(sourcePaths.statePath, "utf8")) as Record<string, unknown>;
  sourceRaw.relations = sourceRelations;
  writeFileSync(sourcePaths.statePath, `${JSON.stringify(sourceRaw, null, 2)}\n`);

  // Write target side
  const targetRelations = [
    ...(targetState.relations ?? []),
    { relation: targetLabel, issueId: input.sourceId, createdAt: now },
  ];
  const targetPaths = getIssuePaths(root, input.targetId);
  const targetRaw = JSON.parse(readFileSync(targetPaths.statePath, "utf8")) as Record<string, unknown>;
  targetRaw.relations = targetRelations;
  writeFileSync(targetPaths.statePath, `${JSON.stringify(targetRaw, null, 2)}\n`);

  return {
    ...sourceState,
    relations: sourceRelations.map((r) => ({
      ...r,
      relation: r.relation as "parent" | "child" | "related",
      createdAt: r.createdAt,
    })),
  };
}

function runIssueBatch(issueId: string) {
  const state = readIssueState({ issueId });
  const relations = state.relations ?? [];
  const batchIssues = [issueId, ...relations.map((r) => r.issueId)];

  console.log(`batch for ${issueId}`);
  console.log("─".repeat(60));
  console.log(`${issueId}  ${state.currentPhase}  (self)`);

  for (const rel of relations) {
    try {
      const relState = readIssueState({ issueId: rel.issueId });
      const marker = rel.relation === "parent" ? "↑ parent" : rel.relation === "child" ? "↓ child" : "→ related";
      console.log(`${rel.issueId}  ${relState.currentPhase}  (${marker})`);
    } catch {
      console.log(`${rel.issueId}  (unknown)  (${rel.relation})`);
    }
  }

  if (relations.length === 0) {
    console.log("(no related issues)");
  }
}

function parseIssueTypeOption(argv: string[], fallback: IssueType): IssueType {
  if (!argv.includes("--type")) return fallback;
  return parseIssueType(optionRequiredValue(argv, "--type"));
}

function parseIssueTypesOption(argv: string[]): IssueType[] | undefined {
  if (!argv.includes("--type")) return undefined;
  const raw = optionRequiredValue(argv, "--type");
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`--type requires one or more of: ${ISSUE_TYPE_LIST}`);
  }
  return values.map(parseIssueType);
}

function parseIssueType(value: string): IssueType {
  if (!isIssueType(value)) {
    throw new Error(`Invalid issue type: ${value}; expected ${ISSUE_TYPE_LIST}`);
  }
  return value;
}

function formatList(values: readonly string[]) {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}
