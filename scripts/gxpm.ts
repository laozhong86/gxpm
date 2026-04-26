import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendIssueEvent,
  createIssueState,
  getIssuePaths,
  readIssueState,
  setIssueArchived,
  transitionIssuePhase,
  type StateEvent,
} from "../core/state";
import { hasArtifact, listArtifacts, readArtifact, writeArtifact } from "../core/artifacts";
import { readResumePacket, writeIssueCheckpoint } from "../core/checkpoint";
import {
  evaluateCommitMsg,
  evaluatePostMerge,
  evaluatePreCommit,
  evaluatePrePush,
} from "../core/gate";
import {
  getConfigValue,
  listConfig,
  resolveWorktreePolicy,
  setConfigValue,
} from "../core/config";
import { getNextAvailableIssueId, listIssues, recentLandedIssues } from "../core/issues";
import { initializeLandFindings } from "../core/land";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { formatDoctorReport, runDoctor } from "./doctor";
import { findPhaseArtifactCommand } from "./phase-artifact-commands";
import { runPostLandSkillSync } from "./post-land-sync";
import { runScaffoldCheck } from "./scaffold-check";
import { readGxpmVersion } from "./version";

function main(argv: string[]) {
  const [command, subcommand, issueId, value] = argv;

  if (!command || command === "check") {
    console.log(runScaffoldCheck());
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(readGxpmVersion());
    return;
  }

  if (command === "config") {
    runConfigCommand(argv, subcommand, issueId, value);
    return;
  }

  if (command === "worktree" && subcommand === "policy") {
    const policy = resolveWorktreePolicy();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(policy, null, 2));
      return;
    }
    console.log(`worktree.enforcement: ${policy.enforcement}`);
    console.log(`worktree.default:     ${policy.default}`);
    console.log(`source:               ${policy.source}`);
    return;
  }

  if (command === "doctor") {
    const json = argv.includes("--json");
    const report = runDoctor();
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    return;
  }

  if (command === "issue" && subcommand === "create") {
    let resolvedId = issueId;
    if (!resolvedId || resolvedId === "--auto-id") {
      if (argv.includes("--auto-id") || !resolvedId) {
        if (!resolvedId && !argv.includes("--auto-id")) {
          throw new Error("Usage: gxpm issue create <issue-id>  (or --auto-id)");
        }
        resolvedId = getNextAvailableIssueId();
      }
    }
    if (!resolvedId) {
      throw new Error("Usage: gxpm issue create <issue-id>  (or --auto-id)");
    }
    const state = createIssueState({ issueId: resolvedId });
    console.log(`created ${state.issueId} at ${state.currentPhase}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), resolvedId).statePath}`);
    return;
  }

  if (command === "issue" && subcommand === "status") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue status <issue-id>");
    }
    const state = readIssueState({ issueId });
    console.log(`issueId: ${state.issueId}`);
    console.log(`currentPhase: ${state.currentPhase}`);
    console.log(`updatedAt: ${state.updatedAt}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
    return;
  }

  if (command === "issue" && subcommand === "list") {
    const json = argv.includes("--json");
    const includeAll = argv.includes("--all");
    const archivedOnly = argv.includes("--archived");
    const recentIdx = argv.indexOf("--recent");
    const recentN = recentIdx >= 0 ? parseInt(argv[recentIdx + 1] ?? "5", 10) || 5 : 0;
    let entries: ReturnType<typeof listIssues>;
    if (recentN > 0) {
      entries = recentLandedIssues({ limit: recentN });
    } else {
      entries = listIssues({ includeAll, archivedOnly });
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
    const phaseWidth = Math.max(13, ...entries.map((e) => e.currentPhase.length));
    console.log(`${"ISSUE".padEnd(idWidth)}  ${"PHASE".padEnd(phaseWidth)}  UPDATED                   FLAGS`);
    for (const entry of entries) {
      const flags = entry.archived ? "archived" : "";
      console.log(
        `${entry.issueId.padEnd(idWidth)}  ${entry.currentPhase.padEnd(phaseWidth)}  ${entry.updatedAt}  ${flags}`,
      );
    }
    return;
  }

  if (command === "issue" && subcommand === "archive") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue archive <issue-id>");
    }
    setIssueArchived({ issueId, archived: true });
    console.log(`archived ${issueId}`);
    return;
  }

  if (command === "issue" && subcommand === "unarchive") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue unarchive <issue-id>");
    }
    setIssueArchived({ issueId, archived: false });
    console.log(`unarchived ${issueId}`);
    return;
  }

  if (command === "issue" && subcommand === "next") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue next <issue-id>");
    }
    runIssueNext(issueId);
    return;
  }

  if (command === "issue" && subcommand === "checkpoint") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue checkpoint <issue-id> --title <title> --json <json> | --from <file> | --stdin");
    }
    runIssueCheckpoint(argv, issueId);
    return;
  }

  if (command === "issue" && subcommand === "resume") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue resume <issue-id>");
    }
    runIssueResume(issueId);
    return;
  }

  if (command === "issue" && subcommand === "history") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue history <issue-id> [--json]");
    }
    runIssueHistory(issueId, argv.includes("--json"));
    return;
  }

  if (command === "issue" && subcommand === "transition") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm issue transition <issue-id> <phase>");
    }
    const before = readIssueState({ issueId });
    const after = transitionIssuePhase({ issueId, nextPhase: value });
    console.log(`transitioned ${after.issueId}: ${before.currentPhase} -> ${after.currentPhase}`);
    if (after.currentPhase === "land") {
      const sync = runPostLandSkillSync({ env: process.env });
      if (!sync.ok) {
        console.error(`[gxpm land sync] ${sync.message}`);
      }
    }
    return;
  }

  if (command === "artifact" && subcommand === "list") {
    if (!issueId) {
      throw new Error("Usage: gxpm artifact list <issue-id>");
    }
    const artifacts = listArtifacts({ issueId });
    if (artifacts.length === 0) {
      console.log("no artifacts");
      return;
    }
    for (const artifact of artifacts) {
      console.log(`${artifact.type}\t${artifact.path}\t${artifact.writtenAt}`);
    }
    return;
  }

  if (command === "artifact" && subcommand === "read") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm artifact read <issue-id> <type>");
    }
    console.log(JSON.stringify(readArtifact({ issueId, type: value }), null, 2));
    return;
  }

  if (command === "artifact" && subcommand === "write") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm artifact write <issue-id> <type> --json <json> | --from <file> | --stdin");
    }
    runArtifactWrite(argv, issueId, value);
    return;
  }

  if (command === "artifact" && subcommand === "edit") {
    if (!issueId || !value) {
      throw new Error("Usage: gxpm artifact edit <issue-id> <type>");
    }
    runArtifactEdit(issueId, value);
    return;
  }

  if (command === "gate" && subcommand === "pre-commit") {
    runPreCommitGate(argv, issueId);
    return;
  }

  if (command === "gate" && subcommand === "commit-msg") {
    runCommitMsgGate(argv, issueId);
    return;
  }

  if (command === "gate" && subcommand === "pre-push") {
    runPrePushGate(issueId);
    return;
  }

  if (command === "gate" && subcommand === "post-merge") {
    runPostMergeGate(issueId);
    return;
  }

  const phaseArtifactCommand = findPhaseArtifactCommand(command, subcommand);
  if (phaseArtifactCommand) {
    if (!issueId) {
      throw new Error(`Usage: ${phaseArtifactCommand.command}`);
    }
    phaseArtifactCommand.initialize({ issueId });
    console.log(phaseArtifactCommand.successMessage(issueId));
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

function runConfigCommand(
  argv: string[],
  subcommand: string | undefined,
  thirdArg: string | undefined,
  fourthArg: string | undefined,
) {
  if (subcommand === "get") {
    if (!thirdArg) throw new Error("Usage: gxpm config get <key>");
    const result = getConfigValue({ key: thirdArg });
    if (result.value === undefined) {
      console.log(`${thirdArg}: <unset>`);
    } else {
      console.log(`${thirdArg}: ${JSON.stringify(result.value)}`);
      console.log(`source:  ${result.source}`);
    }
    return;
  }

  if (subcommand === "set") {
    if (!thirdArg || fourthArg === undefined) {
      throw new Error("Usage: gxpm config set <key> <value> [--global]");
    }
    const scope = argv.includes("--global") ? "global" : "repo";
    const path = setConfigValue({
      scope,
      key: thirdArg,
      value: parseConfigValueLiteral(fourthArg),
    });
    console.log(`set ${thirdArg} = ${fourthArg} (${scope}); wrote ${path}`);
    return;
  }

  if (subcommand === "list" || !subcommand) {
    const all = listConfig();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }
    console.log("=== repo (.gxpm/config.json) ===");
    console.log(JSON.stringify(all.repo, null, 2));
    console.log("");
    console.log("=== global (~/.gxpm/config.json) ===");
    console.log(JSON.stringify(all.global, null, 2));
    return;
  }

  throw new Error(`Unknown config subcommand: ${subcommand}`);
}

function parseConfigValueLiteral(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
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
    case "checkpoint.written":
      return `${p.checkpointPath ?? "?"} (${p.resumePacketPath ?? ""})`;
    case "gate.passed":
      if (p.gate) return `${p.gate} (${p.code ?? ""})`;
      return `${p.fromPhase ?? "?"} → ${p.toPhase ?? "?"} (${p.requiredArtifact ?? ""})`;
    case "gate.blocked":
      if (p.gate) return `${p.gate}: ${p.reason ?? ""}`;
      return `${p.fromPhase ?? "?"} → ${p.toPhase ?? "?"} blocked: ${p.missingArtifact ?? ""}`;
    default:
      return JSON.stringify(p);
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
  if (!has) {
    console.log(`Next: ${rule.command.replace("<issue-id>", issueId)}`);
    console.log(`      → creates draft of artifact: ${rule.requiredArtifact}`);
    console.log("");
    console.log(`Then: edit the artifact (or use 'gxpm artifact write ${issueId} ${rule.requiredArtifact} --json ...')`);
    console.log(`Then: gxpm issue transition ${issueId} ${rule.nextPhase}`);
  } else {
    console.log(`Artifact ${rule.requiredArtifact} already exists.`);
    console.log(`Next: gxpm issue transition ${issueId} ${rule.nextPhase}`);
  }
}

function runIssueCheckpoint(argv: string[], issueId: string) {
  const payload = readJsonPayloadFromArgs(argv, "gxpm issue checkpoint");
  const title = optionValue(argv, "--title") ?? payloadTitle(payload) ?? "checkpoint";
  const record = writeIssueCheckpoint({
    issueId,
    title,
    branch: currentGitBranch(),
    payload,
  });
  console.log(`checkpoint saved for ${issueId}`);
  console.log(`file: ${record.path}`);
  console.log(`resume: ${record.resumePacketPath}`);
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

function runArtifactEdit(issueId: string, type: string) {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";

  let initial = "{}\n";
  if (hasArtifact({ issueId, type })) {
    const stored = readArtifact({ issueId, type });
    initial = `${JSON.stringify(stored.payload, null, 2)}\n`;
  }

  const tmpFile = `/tmp/gxpm-edit-${issueId}-${type}-${Date.now()}.json`;
  writeFileSync(tmpFile, initial);

  const editorResult = Bun.spawnSync({
    cmd: [editor, tmpFile],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (editorResult.exitCode !== 0) {
    console.error(`editor "${editor}" exited with code ${editorResult.exitCode}; tempfile preserved at ${tmpFile}`);
    process.exit(1);
  }

  const after = readFileSync(tmpFile, "utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(after);
  } catch (error) {
    console.error(
      `gxpm artifact edit: invalid JSON saved by editor — ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`Your edit is preserved at: ${tmpFile}`);
    process.exit(1);
  }

  writeArtifact({ issueId, type, payload });
  // best-effort cleanup
  try {
    require("node:fs").unlinkSync(tmpFile);
  } catch {}
  console.log(`updated ${type} for ${issueId}`);
}

function runArtifactWrite(argv: string[], issueId: string, type: string) {
  const payload = readJsonPayloadFromArgs(argv, "gxpm artifact write");
  const record = writeArtifact({ issueId, type, payload });
  console.log(`wrote ${record.type} for ${issueId} at ${record.path}`);
}

function readJsonPayloadFromArgs(argv: string[], usagePrefix: string) {
  const dashJson = argv.indexOf("--json");
  const dashFrom = argv.indexOf("--from");
  const useStdin = argv.includes("--stdin");

  const inputs = [dashJson >= 0, dashFrom >= 0, useStdin].filter(Boolean).length;
  if (inputs === 0) {
    throw new Error(`${usagePrefix} requires one of: --json <json> | --from <file> | --stdin`);
  }
  if (inputs > 1) {
    throw new Error(`${usagePrefix}: pick exactly one of --json / --from / --stdin`);
  }

  let raw: string;
  if (dashJson >= 0) {
    raw = argv[dashJson + 1] ?? "";
  } else if (dashFrom >= 0) {
    const file = argv[dashFrom + 1];
    if (!file) throw new Error("--from requires a file path");
    raw = readFileSync(file, "utf8");
  } else {
    raw = readFileSync("/dev/stdin", "utf8");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${usagePrefix}: invalid JSON payload — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function optionValue(argv: string[], option: string) {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function payloadTitle(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const title = (payload as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : null;
}

function currentGitBranch() {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  const branch = result.stdout.toString().trim();
  return branch || undefined;
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
}

try {
  main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
