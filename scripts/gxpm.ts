import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendIssueEvent,
  createIssueState,
  getIssuePaths,
  readIssueState,
  transitionIssuePhase,
  type StateEvent,
} from "../core/state";
import { hasArtifact, listArtifacts, readArtifact, writeArtifact } from "../core/artifacts";
import {
  evaluateCommitMsg,
  evaluatePostMerge,
  evaluatePreCommit,
  evaluatePrePush,
} from "../core/gate";
import { listIssues } from "../core/issues";
import { initializeLandFindings } from "../core/land";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { formatDoctorReport, runDoctor } from "./doctor";
import { findPhaseArtifactCommand } from "./phase-artifact-commands";
import { runScaffoldCheck } from "./scaffold-check";

function main(argv: string[]) {
  const [command, subcommand, issueId, value] = argv;

  if (!command || command === "check") {
    console.log(runScaffoldCheck());
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
    if (!issueId) {
      throw new Error("Usage: gxpm issue create <issue-id>");
    }
    const state = createIssueState({ issueId });
    console.log(`created ${state.issueId} at ${state.currentPhase}`);
    console.log(`statePath: ${getIssuePaths(process.cwd(), issueId).statePath}`);
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
    const entries = listIssues();
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log("no issues tracked under .gxpm/issues/");
      return;
    }
    const idWidth = Math.max(8, ...entries.map((e) => e.issueId.length));
    const phaseWidth = Math.max(13, ...entries.map((e) => e.currentPhase.length));
    console.log(`${"ISSUE".padEnd(idWidth)}  ${"PHASE".padEnd(phaseWidth)}  UPDATED`);
    for (const entry of entries) {
      console.log(
        `${entry.issueId.padEnd(idWidth)}  ${entry.currentPhase.padEnd(phaseWidth)}  ${entry.updatedAt}`,
      );
    }
    return;
  }

  if (command === "issue" && subcommand === "next") {
    if (!issueId) {
      throw new Error("Usage: gxpm issue next <issue-id>");
    }
    runIssueNext(issueId);
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
  const dashJson = argv.indexOf("--json");
  const dashFrom = argv.indexOf("--from");
  const useStdin = argv.includes("--stdin");

  const inputs = [dashJson >= 0, dashFrom >= 0, useStdin].filter(Boolean).length;
  if (inputs === 0) {
    throw new Error(
      "gxpm artifact write requires one of: --json <json> | --from <file> | --stdin",
    );
  }
  if (inputs > 1) {
    throw new Error("gxpm artifact write: pick exactly one of --json / --from / --stdin");
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

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `gxpm artifact write: invalid JSON payload — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const record = writeArtifact({ issueId, type, payload });
  console.log(`wrote ${record.type} for ${issueId} at ${record.path}`);
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
