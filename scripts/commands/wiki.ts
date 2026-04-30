import { writeArtifact } from "../../core/artifacts";
import { ensureQoderWikiLink } from "../../core/qoder";
import {
  evaluateNativeWiki,
  getNativeWikiContextForIssue,
  getNativeWikiStatus,
  getQoderWikiStatus,
  initializeNativeWiki,
  markQoderWikiReminder,
  markQoderWikiSync,
  queryNativeWiki,
  updateNativeWiki,
  type NativeWikiBuildResult,
  type NativeWikiEvalReport,
  type NativeWikiIssueContext,
  type NativeWikiQueryResult,
  type NativeWikiStatus,
  type QoderWikiStatus,
} from "../../core/wiki";
import { optionRequiredValue, optionValue, parsePositiveIntegerOption } from "./helpers";

const WIKI_CONTEXT_USAGE = "Usage: gxpm wiki context <issue-id> [--phase <phase>] [--limit <n>] [--write-artifact] [--json]";

export function runWikiCommand(argv: string[], subcommand: string | undefined) {
  if (!subcommand || subcommand === "status") {
    const native = getNativeWikiStatus();
    const qoder = getQoderWikiStatus();
    if (argv.includes("--json")) {
      console.log(JSON.stringify({ ...qoder, native, qoder }, null, 2));
    } else {
      console.log(`${formatNativeWikiStatus(native)}\n\n${formatQoderWikiStatus(qoder)}`);
    }
    return;
  }

  if (subcommand === "init" || subcommand === "index") {
    const result = initializeNativeWiki();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatNativeWikiBuildResult(result));
    }
    return;
  }

  if (subcommand === "update") {
    const result = updateNativeWiki();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatNativeWikiBuildResult(result));
    }
    return;
  }

  if (subcommand === "eval") {
    const report = evaluateNativeWiki();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatNativeWikiEvalReport(report));
    }
    return;
  }

  if (subcommand === "query") {
    const query = wikiQueryText(argv);
    if (!query) {
      throw new Error("Usage: gxpm wiki query <text> [--limit <n>] [--json]");
    }
    const result = queryNativeWiki({
      query,
      limit: parsePositiveIntegerOption(argv, "--limit"),
    });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatNativeWikiQueryResult(result));
    }
    return;
  }

  if (subcommand === "context") {
    const contextIssueId = argv[2];
    if (!contextIssueId || contextIssueId.startsWith("--")) {
      throw new Error(WIKI_CONTEXT_USAGE);
    }
    assertNoUnexpectedWikiContextPositionals(argv);
    const result = getNativeWikiContextForIssue({
      issueId: contextIssueId,
      phase: argv.includes("--phase") ? optionRequiredValue(argv, "--phase") : undefined,
      limit: parsePositiveIntegerOption(argv, "--limit"),
    });
    const artifactWritten = argv.includes("--write-artifact");
    if (artifactWritten) {
      writeArtifact({ issueId: contextIssueId, type: "wiki-context", payload: result });
    }
    if (argv.includes("--json")) {
      console.log(JSON.stringify(artifactWritten ? { ...result, artifactWritten: "wiki-context" } : result, null, 2));
    } else {
      console.log(formatNativeWikiIssueContext(result, artifactWritten));
    }
    return;
  }

  if (subcommand === "mark-sync") {
    const record = markQoderWikiSync({ note: optionValue(argv, "--note") ?? undefined });
    console.log(`recorded Qoder wiki manual sync at ${record.lastSyncAt}`);
    console.log("state: .gxpm/wiki/qoder.json");
    return;
  }

  if (subcommand === "mark-reminder") {
    const record = markQoderWikiReminder({ note: optionValue(argv, "--note") ?? undefined });
    console.log(`recorded Qoder wiki reminder at ${record.lastReminderAt}`);
    console.log("state: .gxpm/wiki/qoder.json");
    return;
  }

  throw new Error(`Usage: gxpm wiki status [--json] | gxpm wiki init [--json] | gxpm wiki index [--json] | gxpm wiki update [--json] | gxpm wiki eval [--json] | gxpm wiki query <text> [--limit <n>] [--json] | ${WIKI_CONTEXT_USAGE.replace(/^Usage: /, "")} | gxpm wiki mark-sync [--note <text>] | gxpm wiki mark-reminder [--note <text>]`);
}

export function runQoderCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand === "link") {
    const result = ensureQoderWikiLink({
      target: optionValue(argv, "--target") ?? undefined,
      sharedRoot: optionValue(argv, "--shared-root") ?? undefined,
      replace: argv.includes("--replace"),
    });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`linked .qoder/repowiki -> ${result.sharedRoot}`);
    console.log(`target: ${result.targetRoot}`);
    console.log(`action: ${result.action}`);
    return;
  }

  throw new Error("Usage: gxpm qoder link [--target <repo-or-worktree>] [--shared-root <path>] [--replace] [--json]");
}

function formatQoderWikiStatus(status: QoderWikiStatus) {
  const lines: string[] = [];
  if (!status.detected) {
    lines.push(`Qoder wiki: not detected (${status.repoWikiRoot})`);
    lines.push("Normal gxpm workflow continues.");
    return lines.join("\n");
  }

  lines.push(`Qoder wiki: detected (${status.repoWikiRoot})`);
  lines.push(`state: ${status.state}`);
  lines.push(`pages: ${status.pageCount}`);
  if (status.contentRoots.length > 0) {
    lines.push(`content roots: ${status.contentRoots.join(", ")}`);
  }
  lines.push("");
  lines.push("Progressive read before source:");
  status.progressiveRead.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  if (status.topPages.length > 0) {
    lines.push("");
    lines.push("Top wiki pages:");
    for (const page of status.topPages.slice(0, 5)) {
      const cited = page.citedFiles.length > 0 ? ` -> ${page.citedFiles.slice(0, 3).join(", ")}` : "";
      lines.push(`- ${page.path}${cited}`);
    }
  }
  lines.push("");
  lines.push(`Weekly sync: ${status.reminder.syncStale ? "stale" : "current"}`);
  lines.push(`Reminder due: ${status.reminder.reminderDue ? "yes" : "no"}`);
  lines.push(`Reason: ${status.reminder.reason}`);
  if (status.reminder.reminderDue) {
    lines.push(`After reminding, run: ${status.commands.markReminder}`);
  }
  lines.push(`After manual Qoder resync, run: ${status.commands.markSync}`);
  return lines.join("\n");
}

function formatNativeWikiStatus(status: NativeWikiStatus) {
  const lines = [`Native gxpm wiki: ${status.state}`];
  if (!status.detected) {
    lines.push(`state: ${status.paths.state} not initialized`);
    lines.push(`Reason: ${status.reason}`);
    lines.push(`Run: ${status.commands.init}`);
    return lines.join("\n");
  }
  lines.push(`generatedAt: ${status.generatedAt ?? "unknown"}`);
  lines.push(`baseCommit: ${status.baseCommit ?? "unknown"}`);
  lines.push(`currentCommit: ${status.currentCommit ?? "unknown"}`);
  lines.push(`files: ${status.indexedFiles}`);
  lines.push(`edges: ${status.graphEdges}`);
  lines.push(`dimensions: ${status.dimensionedFiles}`);
  lines.push(`docs: ${status.docs.join(", ") || "none"}`);
  lines.push(`stale: ${status.stale ? "yes" : "no"}`);
  lines.push(`Reason: ${status.reason}`);
  if (status.changedFiles.length > 0) {
    lines.push("Changed files:");
    for (const file of status.changedFiles.slice(0, 10)) lines.push(`- ${file}`);
  }
  if (status.stale) lines.push(`Run: ${status.commands.update}`);
  return lines.join("\n");
}

function formatNativeWikiBuildResult(result: NativeWikiBuildResult) {
  return [
    `Native gxpm wiki: ${result.mode}`,
    `state: ${result.state.status}`,
    `baseCommit: ${result.state.baseCommit ?? "unknown"}`,
    `files: ${result.index.files.length}`,
    `edges: ${result.graph.edges.length}`,
    `dimensions: ${result.dimensions.files.length}`,
    `docs: ${result.docs.join(", ")}`,
  ].join("\n");
}

function formatNativeWikiEvalReport(report: NativeWikiEvalReport) {
  const lines = [
    `Native gxpm wiki eval: ${report.native.status.state}`,
    `generated docs: ${report.native.generatedDocs.count}`,
    `project topic clusters: ${report.native.projectTopics.clusterCount}`,
    `indexed files: ${report.native.sourceCoverage.indexedFiles}`,
    `source-anchored files: ${report.native.sourceCoverage.anchoredFiles}`,
    `orphan indexed files: ${report.native.sourceCoverage.orphanIndexedFiles}`,
    `Qoder comparison: ${report.qoder.detected ? `${report.qoder.pageCount} pages` : "not detected"}`,
  ];
  if (report.qoder.topLevelDirs.length > 0) {
    lines.push(`Qoder top-level dirs: ${report.qoder.topLevelDirs.join(", ")}`);
  }
  if (report.native.queryScenarios.length > 0) {
    lines.push("");
    lines.push("Query scenarios:");
    for (const scenario of report.native.queryScenarios) {
      lines.push(`- ${scenario.query}: ${scenario.topFiles.slice(0, 3).join(", ") || "no matches"}`);
    }
  }
  lines.push("");
  lines.push("Recommendations:");
  for (const recommendation of report.recommendations) lines.push(`- ${recommendation}`);
  return lines.join("\n");
}

function formatNativeWikiQueryResult(result: NativeWikiQueryResult) {
  const lines = [`Native gxpm wiki query: ${result.query}`];
  if (result.results.length === 0) {
    lines.push("No matches. Try `gxpm wiki init` if the index is stale.");
    return lines.join("\n");
  }
  lines.push("Context files:");
  for (const file of result.contextFiles) lines.push(`- ${file}`);
  if (result.suggestedDocs.length > 0) {
    lines.push("Suggested docs:");
    for (const doc of result.suggestedDocs) lines.push(`- ${doc}`);
  }
  return lines.join("\n");
}

function formatNativeWikiIssueContext(result: NativeWikiIssueContext, artifactWritten: boolean) {
  const lines = [
    `Native gxpm wiki context: ${result.issueId}`,
    `phase: ${result.phase} (current: ${result.currentPhase})`,
    `query: ${result.query}`,
  ];
  if (result.artifactsUsed.length > 0) {
    lines.push("Artifacts used:");
    for (const artifact of result.artifactsUsed) lines.push(`- ${artifact.type}`);
  }
  if (result.contextFiles.length === 0) {
    lines.push("No context files matched. Try `gxpm wiki update` if the index is stale.");
  } else {
    lines.push("Context files:");
    for (const file of result.contextFiles) lines.push(`- ${file}`);
  }
  if (result.suggestedDocs.length > 0) {
    lines.push("Suggested docs:");
    for (const doc of result.suggestedDocs) lines.push(`- ${doc}`);
  }
  if (artifactWritten) lines.push("Artifact written: wiki-context");
  return lines.join("\n");
}

function wikiQueryText(argv: string[]) {
  const values: string[] = [];
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") continue;
    if (arg === "--limit") {
      index++;
      continue;
    }
    if (arg.startsWith("--")) continue;
    values.push(arg);
  }
  return values.join(" ").trim();
}

function assertNoUnexpectedWikiContextPositionals(argv: string[]) {
  const optionsWithValues = new Set(["--phase", "--limit"]);
  const flagOptions = new Set(["--json", "--write-artifact"]);
  for (let index = 3; index < argv.length; index++) {
    const arg = argv[index];
    if (optionsWithValues.has(arg)) {
      index++;
      continue;
    }
    if (flagOptions.has(arg)) continue;
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option for gxpm wiki context: ${arg}`);
    }
    throw new Error(WIKI_CONTEXT_USAGE);
  }
}
