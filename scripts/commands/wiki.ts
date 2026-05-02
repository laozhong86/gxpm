import { writeArtifact } from "../../core/artifacts";
import {
  ensureNativeWikiCurrent,
  evaluateNativeWiki,
  getNativeWikiContextForIssue,
  getNativeWikiStatus,
  initializeNativeWiki,
  queryNativeWiki,
  updateNativeWiki,
  type NativeWikiBuildResult,
  type NativeWikiEvalReport,
  type NativeWikiIssueContext,
  type NativeWikiQueryResult,
  type NativeWikiStatus,
} from "../../core/wiki";
import { optionRequiredValue, parsePositiveIntegerOption } from "./helpers";

const WIKI_CONTEXT_USAGE = "Usage: gxpm wiki context <issue-id> [--phase <phase>] [--limit <n>] [--write-artifact] [--json] [--no-auto-update]";

export function runWikiCommand(argv: string[], subcommand: string | undefined) {
  if (!subcommand || subcommand === "status") {
    const native = getNativeWikiStatus();
    if (argv.includes("--json")) {
      console.log(JSON.stringify({ native }, null, 2));
    } else {
      console.log(formatNativeWikiStatus(native));
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
      throw new Error("Usage: gxpm wiki query <text> [--limit <n>] [--json] [--no-auto-update]");
    }
    const result = queryNativeWiki({
      query,
      limit: parsePositiveIntegerOption(argv, "--limit"),
      autoUpdate: !argv.includes("--no-auto-update"),
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
      autoUpdate: !argv.includes("--no-auto-update"),
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

  throw new Error(`Usage: gxpm wiki status [--json] | gxpm wiki init [--json] | gxpm wiki index [--json] | gxpm wiki update [--json] | gxpm wiki eval [--json] | gxpm wiki query <text> [--limit <n>] [--json] | ${WIKI_CONTEXT_USAGE.replace(/^Usage: /, "")}`);
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
  ];
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
    if (arg.startsWith("--")) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) index++;
      continue;
    }
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
