import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import ts from "typescript";
import { listArtifacts, readArtifact, type ArtifactType } from "./artifacts";
import { GXPM_PHASES, isGxpmPhase, readIssueState, type GxpmPhase } from "./state";

const NATIVE_WIKI_ROOT = ".gxpm/wiki";
const NATIVE_WIKI_STATE_PATH = ".gxpm/wiki/state.json";
const NATIVE_WIKI_INDEX_PATH = ".gxpm/wiki/index/files.json";
const NATIVE_WIKI_GRAPH_PATH = ".gxpm/wiki/index/graph.json";
const NATIVE_WIKI_DIMENSIONS_PATH = ".gxpm/wiki/index/dimensions.json";
const NATIVE_WIKI_CONTENT_ROOT = ".gxpm/wiki/content";
const NATIVE_WIKI_DOC_MANIFEST_PATH = ".gxpm/wiki/content/generated-docs.json";
const NATIVE_WIKI_MODULE_TREE_PATH = ".gxpm/wiki/index/module_tree.json";
const NATIVE_WIKI_PROJECT_TOPIC_DIR = "project-topics";
const NATIVE_WIKI_CONFIG_PATH = ".gxpm/wiki.json";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOP_PAGES = 8;
const NATIVE_MAX_FILE_BYTES = 1_000_000;
const NATIVE_IMPORT_RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"];
const NATIVE_TEXT_EXTENSIONS = new Set([
  "",
  ...NATIVE_IMPORT_RESOLVABLE_EXTENSIONS,
  ".sh",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);
const NATIVE_SKIP_DIRS = new Set([
  ".claude",
  ".codex",
  ".git",
  ".gxpm",
  ".qoder",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

export interface WikiPageSummary {
  path: string;
  title: string;
  citedFiles: string[];
}

export interface NativeWikiFileEntry {
  path: string;
  language: string;
  sizeBytes: number;
  mtimeMs: number;
  lineCount?: number;
  exports: string[];
  imports: string[];
  headings: string[];
  symbols: Array<{ name: string; kind: string; line: number }>;
  contentHash: string;
}

export interface NativeWikiIndex {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  files: NativeWikiFileEntry[];
}

interface NativeWikiIndexSnapshot {
  index: NativeWikiIndex;
  contents: Map<string, string>;
}

export interface NativeWikiGraphEdge {
  from: string;
  to: string;
  kind: "imports";
}

export interface NativeWikiGraph {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  nodes: Array<{ path: string; language: string }>;
  edges: NativeWikiGraphEdge[];
  unresolvedImports: Array<{ from: string; specifier: string }>;
}

export interface NativeWikiFileDimensions {
  path: string;
  language: string;
  dimensions: {
    structure: string[];
    symbols: string[];
    apis: string[];
    workflows: string[];
    config: string[];
    tests: string[];
    docs: string[];
    relations: string[];
  };
}

export interface NativeWikiDimensions {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  files: NativeWikiFileDimensions[];
}

export interface NativeWikiState {
  schemaVersion: 1;
  provider: "gxpm";
  status: "idle" | "updating" | "queued";
  baseCommit: string | null;
  generatedAt: string;
  indexPath: string;
  graphPath: string;
  dimensionsPath: string;
  contentRoot: string;
  queuedCommit: string | null;
}

export interface NativeWikiStatus {
  schemaVersion: 1;
  provider: "gxpm";
  detected: boolean;
  state: "absent" | "current" | "stale";
  stale: boolean;
  reason: string;
  baseCommit: string | null;
  currentCommit: string | null;
  generatedAt?: string;
  indexedFiles: number;
  graphEdges: number;
  dimensionedFiles: number;
  docs: string[];
  changedFiles: string[];
  paths: {
    state: string;
    index: string;
    graph: string;
    dimensions: string;
    contentRoot: string;
  };
  commands: {
    init: string;
    update: string;
    query: string;
    context: string;
  };
}

export interface NativeWikiBuildResult {
  provider: "gxpm";
  mode: "init" | "update";
  state: NativeWikiState;
  index: NativeWikiIndex;
  graph: NativeWikiGraph;
  dimensions: NativeWikiDimensions;
  docs: string[];
}

export interface NativeWikiQueryResult {
  provider: "gxpm";
  query: string;
  results: Array<{
    path: string;
    source: "file-index";
    score: number;
    matches: string[];
  }>;
  contextFiles: string[];
  suggestedDocs: string[];
}

export interface NativeWikiIssueContext {
  schemaVersion: 1;
  provider: "gxpm";
  issueId: string;
  currentPhase: GxpmPhase;
  phase: GxpmPhase;
  query: string;
  artifactsUsed: Array<{
    type: ArtifactType;
    writtenAt: string;
  }>;
  results: NativeWikiQueryResult["results"];
  contextFiles: string[];
  suggestedDocs: string[];
}

export interface NativeWikiConfig {
  repo_notes?: string[];
  priority_dirs?: string[];
  exclude_from_map?: string[];
}

export interface NativeWikiModuleTree {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  root: {
    name: string;
    children: NativeWikiModuleTreeNode[];
  };
}

export interface NativeWikiModuleTreeNode {
  name: string;
  type: "file" | "directory";
  children?: NativeWikiModuleTreeNode[];
  fileCount?: number;
}

export interface NativeWikiEvalReport {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  native: {
    status: NativeWikiStatus;
    generatedDocs: {
      count: number;
      names: string[];
    };
    projectTopics: {
      clusterCount: number;
      clusterTitles: string[];
    };
    sourceCoverage: {
      indexedFiles: number;
      dimensionedFiles: number;
      graphEdges: number;
      docsWithSourceAnchors: number;
      anchoredFiles: number;
      orphanIndexedFiles: number;
      orphanIndexedFileExamples: string[];
    };
    queryScenarios: Array<{
      query: string;
      topFiles: string[];
      suggestedDocs: string[];
    }>;
  };
  recommendations: string[];
}

const DEFAULT_NATIVE_WIKI_EVAL_QUERIES = [
  "phase gate artifact lifecycle",
  "host adapter codex",
];

export function initializeNativeWiki(input: { root?: string; now?: Date } = {}): NativeWikiBuildResult {
  return writeNativeWiki({ root: input.root, now: input.now, mode: "init" });
}

export function updateNativeWiki(input: { root?: string; now?: Date } = {}): NativeWikiBuildResult {
  return updateNativeWikiIncremental({ root: input.root, now: input.now });
}

export function ensureNativeWikiCurrent(input: { root?: string; autoUpdate?: boolean } = {}): void {
  if (input.autoUpdate === false) return;
  if (process.env.GXPM_WIKI_AUTO_UPDATE === "0") return;
  const root = input.root ?? process.cwd();
  const status = getNativeWikiStatus({ root });
  if (status.stale) {
    updateNativeWiki({ root });
  }
}

export function getNativeWikiStatus(input: { root?: string; now?: Date } = {}): NativeWikiStatus {
  const root = input.root ?? process.cwd();
  const currentCommit = currentGitCommit(root);
  const paths = nativeWikiStatusPaths();
  const commands = nativeWikiStatusCommands();
  const state = readNativeWikiStateIfPresent(root);
  const index = readNativeWikiIndexIfPresent(root);
  const graph = readNativeWikiGraphIfPresent(root);
  const dimensions = readNativeWikiDimensionsIfPresent(root);
  const docs = listNativeWikiDocs(root);

  const missingArtifacts: string[] = [];
  if (!state) missingArtifacts.push("state.json missing or unreadable");
  if (!index) missingArtifacts.push("index/files.json missing or unreadable");
  if (!graph) missingArtifacts.push("index/graph.json missing or unreadable");
  if (!dimensions) missingArtifacts.push("index/dimensions.json missing or unreadable");
  if (missingArtifacts.length > 0) {
    const hasAnyArtifacts = !!state || !!index || !!graph || !!dimensions || docs.length > 0;
    return {
      schemaVersion: 1,
      provider: "gxpm",
      detected: hasAnyArtifacts,
      state: hasAnyArtifacts ? "stale" : "absent",
      stale: true,
      reason: hasAnyArtifacts ? missingArtifacts.join("; ") : "Native gxpm wiki has not been initialized.",
      baseCommit: state?.baseCommit ?? null,
      currentCommit,
      generatedAt: state?.generatedAt,
      indexedFiles: index?.files.length ?? 0,
      graphEdges: graph?.edges.length ?? 0,
      dimensionedFiles: dimensions?.files.length ?? 0,
      docs,
      changedFiles: index ? changedNativeFiles(root, index) : [],
      paths,
      commands,
    };
  }

  const changedFiles = changedNativeFiles(root, index);
  const reasons: string[] = [];
  if (state.baseCommit !== currentCommit) {
    reasons.push("baseCommit differs from current HEAD");
  }
  if (changedFiles.length > 0) {
    reasons.push("tracked files changed after generation");
  }
  const stale = reasons.length > 0;
  return {
    schemaVersion: 1,
    provider: "gxpm",
    detected: true,
    state: stale ? "stale" : "current",
    stale,
    reason: stale ? reasons.join("; ") : "Native gxpm wiki is current for the working tree.",
    baseCommit: state.baseCommit,
    currentCommit,
    generatedAt: state.generatedAt,
    indexedFiles: index.files.length,
    graphEdges: graph?.edges.length ?? 0,
    dimensionedFiles: dimensions.files.length,
    docs,
    changedFiles,
    paths,
    commands,
  };
}

export function buildNativeWikiIndex(input: { root?: string; now?: Date } = {}): NativeWikiIndex {
  return buildNativeWikiIndexSnapshot(input).index;
}

function buildNativeWikiIndexSnapshot(input: { root?: string; now?: Date } = {}): NativeWikiIndexSnapshot {
  const root = input.root ?? process.cwd();
  const generatedAt = (input.now ?? new Date()).toISOString();
  const contents = new Map<string, string>();
  return {
    index: {
      schemaVersion: 1,
      provider: "gxpm",
      generatedAt,
      files: listNativeRepoFiles(root).map((file) => summarizeNativeFile(root, file, contents)),
    },
    contents,
  };
}

export function queryNativeWiki(input: {
  root?: string;
  query: string;
  limit?: number;
  autoUpdate?: boolean;
}): NativeWikiQueryResult {
  const root = input.root ?? process.cwd();
  ensureNativeWikiCurrent({ root, autoUpdate: input.autoUpdate });
  const index = readNativeWikiIndex(root);
  const graph = readNativeWikiGraphIfPresent(root);
  const tokens = tokenizeQuery(input.query);

  // Phase 1: token-match scoring
  const candidates = index.files
    .map((file) => {
      const matches = nativeFileMatches(file, tokens);
      return {
        path: file.path,
        source: "file-index" as const,
        score: matches.reduce((sum, match) => sum + match.score, 0),
        matches: matches.map((match) => match.label),
      };
    })
    .filter((result) => result.score > 0);

  // Phase 2: PageRank re-ranking using matched files as seeds
  if (graph && candidates.length > 0) {
    const seeds = new Set(candidates.map((c) => c.path));
    const pageRanks = computeNativePageRank(graph, seeds);
    for (const candidate of candidates) {
      const pr = pageRanks.get(candidate.path) ?? 0;
      candidate.score = candidate.score * (1 + pr * 5);
    }
  }

  const scored = candidates
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, input.limit ?? 5);
  const contextFiles = scored.map((result) => result.path);
  return {
    provider: "gxpm",
    query: input.query,
    results: scored,
    contextFiles,
    suggestedDocs: suggestedNativeDocs(root, contextFiles, tokens),
  };
}

function clipContextByTokenBudget(
  root: string,
  files: string[],
  budgetTokens: number,
): string[] {
  let used = 0;
  const kept: string[] = [];
  for (const path of files) {
    const content = safeRead(join(root, path));
    const estimated = Math.ceil(content.length / 4);
    if (used + estimated > budgetTokens && kept.length > 0) {
      break;
    }
    kept.push(path);
    used += estimated;
  }
  return kept;
}

export function getNativeWikiContextForIssue(input: {
  root?: string;
  issueId: string;
  phase?: GxpmPhase | string;
  limit?: number;
  autoUpdate?: boolean;
}): NativeWikiIssueContext {
  const root = input.root ?? process.cwd();
  ensureNativeWikiCurrent({ root, autoUpdate: input.autoUpdate });
  const state = readIssueState({ root, issueId: input.issueId });
  const phase = resolveIssueContextPhase(input.phase ?? state.currentPhase);
  const artifacts = readIssueContextArtifacts(root, input.issueId);
  const query = buildIssueContextQuery({
    issueId: input.issueId,
    issueType: state.issueType ?? "feature",
    currentPhase: state.currentPhase,
    phase,
    artifacts,
  });
  const result = queryNativeWiki({ root, query, limit: input.limit });
  const budget = parseInt(process.env.GXPM_WIKI_MAX_CONTEXT_TOKENS ?? "8192", 10);
  const clippedFiles = clipContextByTokenBudget(root, result.contextFiles, budget);
  return {
    schemaVersion: 1,
    provider: "gxpm",
    issueId: input.issueId,
    currentPhase: state.currentPhase,
    phase,
    query,
    artifactsUsed: artifacts.map((artifact) => ({
      type: artifact.type,
      writtenAt: artifact.writtenAt,
    })),
    results: result.results.filter((r) => clippedFiles.includes(r.path)),
    contextFiles: clippedFiles,
    suggestedDocs: suggestedNativeDocs(root, clippedFiles, tokenizeQuery(query)),
  };
}

export function evaluateNativeWiki(input: {
  root?: string;
  now?: Date;
  queryScenarios?: string[];
} = {}): NativeWikiEvalReport {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();
  const status = getNativeWikiStatus({ root, now });
  const index = readNativeWikiIndexIfPresent(root);
  const graph = readNativeWikiGraphIfPresent(root);
  const dimensions = readNativeWikiDimensionsIfPresent(root);
  const clusters = index && dimensions ? buildNativeProjectTopicClusters(index, dimensions) : [];
  const sourceCoverage = buildNativeWikiSourceCoverage(root, status.docs, index, graph, dimensions);
  const queryScenarios = index
    ? (input.queryScenarios ?? DEFAULT_NATIVE_WIKI_EVAL_QUERIES).map((query) => {
        const result = queryNativeWiki({ root, query, limit: 5 });
        return {
          query,
          topFiles: result.contextFiles,
          suggestedDocs: result.suggestedDocs,
        };
      })
    : [];

  return {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: now.toISOString(),
    native: {
      status,
      generatedDocs: {
        count: status.docs.length,
        names: status.docs.map((doc) => doc.replace(`${NATIVE_WIKI_CONTENT_ROOT}/`, "")),
      },
      projectTopics: {
        clusterCount: clusters.length,
        clusterTitles: clusters.map((cluster) => cluster.rule.title),
      },
      sourceCoverage,
      queryScenarios,
    },
    recommendations: nativeWikiEvalRecommendations(status, sourceCoverage, clusters.length),
  };
}

const ISSUE_CONTEXT_ARTIFACT_PRIORITY: ArtifactType[] = [
  "issue-intake",
  "acceptance-contract",
  "triage-report",
  "implementation-plan",
  "dispatch-handoff",
  "local-verify",
  "acceptance-check",
  "self-review",
  "ship-readiness",
  "pr-check",
  "verify-findings",
  "qa-findings",
  "land-findings",
];

function resolveIssueContextPhase(value: GxpmPhase | string): GxpmPhase {
  if (!isGxpmPhase(value)) {
    throw new Error(`Invalid phase: ${value}`);
  }
  return value;
}

function readIssueContextArtifacts(root: string, issueId: string) {
  const records = listIssueArtifactsIfPresent(root, issueId);
  const available = new Map(records.map((record) => [record.type, record]));
  return ISSUE_CONTEXT_ARTIFACT_PRIORITY.filter((type) => available.has(type)).map((type) => {
    const stored = readArtifact({ root, issueId, type });
    return {
      type,
      writtenAt: stored.writtenAt,
      payload: stored.payload,
    };
  });
}

function listIssueArtifactsIfPresent(root: string, issueId: string) {
  try {
    return listArtifacts({ root, issueId });
  } catch (error) {
    if (error instanceof Error && error.message === `Artifact index not found: ${issueId}`) {
      return [];
    }
    throw error;
  }
}

function buildIssueContextQuery(input: {
  issueId: string;
  issueType: string;
  currentPhase: GxpmPhase;
  phase: GxpmPhase;
  artifacts: Array<{ type: ArtifactType; payload: unknown }>;
}) {
  const values = [
    input.issueId,
    input.issueType,
    input.currentPhase,
    input.phase,
    ...input.artifacts.flatMap((artifact) => [
      artifact.type,
      ...payloadSearchText(artifact.payload),
    ]),
  ];
  return values.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function payloadSearchText(payload: unknown) {
  const values: string[] = [];
  collectPayloadSearchText(payload, values, 0, { length: 0 });
  return values;
}

function collectPayloadSearchText(
  value: unknown,
  values: string[],
  depth: number,
  state: { length: number },
) {
  if (depth > 5 || state.length > 4000) return;
  if (typeof value === "string") {
    pushPayloadSearchText(values, state, value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    pushPayloadSearchText(values, state, String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloadSearchText(item, values, depth + 1, state));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      pushPayloadSearchText(values, state, key);
      collectPayloadSearchText(nested, values, depth + 1, state);
    }
  }
}

function pushPayloadSearchText(values: string[], state: { length: number }, value: string) {
  if (state.length > 4000) return;
  values.push(value);
  state.length += value.length + 1;
}

function buildNativeWikiSourceCoverage(
  root: string,
  docs: string[],
  index: NativeWikiIndex | null,
  graph: NativeWikiGraph | null,
  dimensions: NativeWikiDimensions | null,
) {
  const indexedFiles = index?.files.map((file) => file.path) ?? [];
  const anchored = new Set<string>();
  let docsWithSourceAnchors = 0;
  for (const doc of docs) {
    const cited = extractCitedFiles(safeRead(join(root, doc)));
    if (cited.length > 0) docsWithSourceAnchors += 1;
    for (const file of cited) anchored.add(file);
  }
  const orphanIndexedFiles = indexedFiles.filter((file) => !anchored.has(file)).sort();
  return {
    indexedFiles: indexedFiles.length,
    dimensionedFiles: dimensions?.files.length ?? 0,
    graphEdges: graph?.edges.length ?? 0,
    docsWithSourceAnchors,
    anchoredFiles: [...anchored].filter((file) => indexedFiles.includes(file)).length,
    orphanIndexedFiles: orphanIndexedFiles.length,
    orphanIndexedFileExamples: orphanIndexedFiles.slice(0, 20),
  };
}

function nativeWikiEvalRecommendations(
  status: NativeWikiStatus,
  coverage: NativeWikiEvalReport["native"]["sourceCoverage"],
  projectTopicClusterCount: number,
) {
  const recommendations: string[] = [];
  if (status.state === "absent") recommendations.push("Run gxpm wiki init.");
  if (status.state === "stale") recommendations.push("Run gxpm wiki update.");
  if (status.state === "current" && projectTopicClusterCount === 0) {
    recommendations.push("Review native topic rules; no project topic clusters were inferred.");
  }
  if (status.state === "current" && coverage.orphanIndexedFiles > 0) {
    recommendations.push("Use orphanIndexedFileExamples to choose the next topic coverage improvement.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Native wiki eval is current; use report metrics to choose the next wiki improvement.");
  }
  return recommendations;
}

export function extractCitedFiles(markdown: string): string[] {
  const files = new Set<string>();
  const re = /file:\/\/([^)#\s]+)(?:#[^)]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    files.add(decodeFileUrlPath(match[1]));
  }
  return [...files].sort();
}

function isOlderThanWeek(value: string | undefined, now: Date) {
  if (!value) return true;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  return now.getTime() - time >= WEEK_MS;
}

function isDescendant(candidate: string, parent: string) {
  const childPath = relative(parent, candidate);
  return childPath !== "" && childPath !== ".." && !childPath.startsWith(`..${sep}`);
}

function isAfter(value: string | undefined, baseline: string | undefined) {
  if (!value || !baseline) return false;
  const valueTime = Date.parse(value);
  const baselineTime = Date.parse(baseline);
  return Number.isFinite(valueTime) && Number.isFinite(baselineTime) && valueTime > baselineTime;
}

function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sha256Hex(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function writeNativeWiki(input: {
  root?: string;
  now?: Date;
  mode: NativeWikiBuildResult["mode"];
}): NativeWikiBuildResult {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();
  const snapshot = buildNativeWikiIndexSnapshot({ root, now });
  const index = snapshot.index;
  const graph = buildNativeWikiGraph(index);
  const dimensions = buildNativeWikiDimensions({ index, graph, contents: snapshot.contents });
  const state: NativeWikiState = {
    schemaVersion: 1,
    provider: "gxpm",
    status: "idle",
    baseCommit: currentGitCommit(root),
    generatedAt: now.toISOString(),
    indexPath: NATIVE_WIKI_INDEX_PATH,
    graphPath: NATIVE_WIKI_GRAPH_PATH,
    dimensionsPath: NATIVE_WIKI_DIMENSIONS_PATH,
    contentRoot: NATIVE_WIKI_CONTENT_ROOT,
    queuedCommit: null,
  };
  mkdirSync(join(root, NATIVE_WIKI_ROOT, "index"), { recursive: true });
  mkdirSync(join(root, NATIVE_WIKI_CONTENT_ROOT), { recursive: true });
  writeJson(join(root, NATIVE_WIKI_INDEX_PATH), index);
  writeJson(join(root, NATIVE_WIKI_GRAPH_PATH), graph);
  writeJson(join(root, NATIVE_WIKI_DIMENSIONS_PATH), dimensions);
  writeJson(join(root, NATIVE_WIKI_STATE_PATH), state);
  const docs = writeNativeWikiDocs(root, state, index, graph, dimensions);
  return { provider: "gxpm", mode: input.mode, state, index, graph, dimensions, docs };
}

function updateNativeWikiIncremental(input: { root?: string; now?: Date }): NativeWikiBuildResult {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();

  // Read existing artifacts
  const existingIndex = readNativeWikiIndex(root);
  const existingGraph = readNativeWikiGraphIfPresent(root) ?? { schemaVersion: 1 as const, provider: "gxpm" as const, generatedAt: "", nodes: [], edges: [], unresolvedImports: [] };
  const existingState = readNativeWikiStateIfPresent(root);

  // Determine changed files via git diff against baseCommit
  const changedFiles = getChangedFilesViaGitDiff(root, existingState?.baseCommit ?? null);

  // Find downstream dependents (files that import changed files)
  const dependentFiles = findDependents(existingGraph, changedFiles);

  // Combine files that need re-processing
  const filesToProcess = new Set([...changedFiles, ...dependentFiles]);

  // Current tracked files on disk
  const trackedPaths = listNativeRepoFiles(root).map((file) => toRepoPath(root, file));
  const trackedSet = new Set(trackedPaths);

  // Build updated index: keep unchanged files, re-parse changed/dependent/new
  const contents = new Map<string, string>();
  const updatedFiles: NativeWikiFileEntry[] = [];
  const existingByPath = new Map(existingIndex.files.map((f) => [f.path, f]));

  for (const file of existingIndex.files) {
    if (!trackedSet.has(file.path)) {
      // File was deleted — skip it
      continue;
    }
    if (filesToProcess.has(file.path)) {
      // Changed or dependent — re-parse
      updatedFiles.push(summarizeNativeFile(root, join(root, file.path), contents));
    } else {
      // Unchanged — keep existing entry (including hash)
      // Backfill symbols if missing from older index schema
      updatedFiles.push({ ...file, symbols: file.symbols ?? [] });
    }
  }

  // Add newly created files
  for (const path of trackedPaths) {
    if (!existingByPath.has(path)) {
      updatedFiles.push(summarizeNativeFile(root, join(root, path), contents));
    }
  }

  updatedFiles.sort((a, b) => a.path.localeCompare(b.path));

  const index: NativeWikiIndex = {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: now.toISOString(),
    files: updatedFiles,
  };

  const graph = buildNativeWikiGraph(index);
  const dimensions = buildNativeWikiDimensions({ index, graph, contents });

  const state: NativeWikiState = {
    schemaVersion: 1,
    provider: "gxpm",
    status: "idle",
    baseCommit: currentGitCommit(root),
    generatedAt: now.toISOString(),
    indexPath: NATIVE_WIKI_INDEX_PATH,
    graphPath: NATIVE_WIKI_GRAPH_PATH,
    dimensionsPath: NATIVE_WIKI_DIMENSIONS_PATH,
    contentRoot: NATIVE_WIKI_CONTENT_ROOT,
    queuedCommit: null,
  };

  mkdirSync(join(root, NATIVE_WIKI_ROOT, "index"), { recursive: true });
  mkdirSync(join(root, NATIVE_WIKI_CONTENT_ROOT), { recursive: true });
  writeJson(join(root, NATIVE_WIKI_INDEX_PATH), index);
  writeJson(join(root, NATIVE_WIKI_GRAPH_PATH), graph);
  writeJson(join(root, NATIVE_WIKI_DIMENSIONS_PATH), dimensions);
  writeJson(join(root, NATIVE_WIKI_STATE_PATH), state);
  const docs = writeNativeWikiDocs(root, state, index, graph, dimensions, changedFiles);
  return { provider: "gxpm", mode: "update", state, index, graph, dimensions, docs };
}

function getChangedFilesViaGitDiff(root: string, baseCommit: string | null): string[] {
  if (!baseCommit) {
    // No base commit known — fallback: treat all tracked files as changed
    return listNativeRepoFiles(root).map((file) => toRepoPath(root, file));
  }
  const result = Bun.spawnSync({
    cmd: ["git", "diff", "--name-only", `${baseCommit}..HEAD`, "--"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    // Fallback to filesystem scan if git diff fails
    return listNativeRepoFiles(root).map((file) => toRepoPath(root, file));
  }
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function findDependents(graph: NativeWikiGraph, changedFiles: string[]): string[] {
  const changedSet = new Set(changedFiles);
  const dependents = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "imports" && changedSet.has(edge.to)) {
      dependents.add(edge.from);
    }
  }
  return [...dependents];
}

function buildNativeWikiGraph(index: NativeWikiIndex): NativeWikiGraph {
  const filePaths = new Set(index.files.map((file) => file.path));
  const edges: NativeWikiGraphEdge[] = [];
  const unresolvedImports: NativeWikiGraph["unresolvedImports"] = [];
  for (const file of index.files) {
    for (const specifier of file.imports) {
      const target = resolveNativeImport(file.path, specifier, filePaths);
      if (target) {
        edges.push({ from: file.path, to: target, kind: "imports" });
      } else if (specifier.startsWith(".")) {
        unresolvedImports.push({ from: file.path, specifier });
      }
    }
  }
  return {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: index.generatedAt,
    nodes: index.files.map((file) => ({ path: file.path, language: file.language })),
    edges: dedupeBy(edges, (edge) => `${edge.from}\0${edge.to}\0${edge.kind}`),
    unresolvedImports,
  };
}

function computeNativePageRank(
  graph: NativeWikiGraph,
  seeds?: Set<string>,
  options: { damping?: number; iterations?: number; epsilon?: number } = {},
): Map<string, number> {
  const { damping = 0.85, iterations = 20, epsilon = 1e-6 } = options;
  const nodePaths = graph.nodes.map((n) => n.path);
  const n = nodePaths.length;
  if (n === 0) return new Map();

  // Build adjacency list (outgoing edges)
  const outgoing = new Map<string, string[]>();
  for (const path of nodePaths) outgoing.set(path, []);
  for (const edge of graph.edges) {
    if (edge.kind === "imports") {
      outgoing.get(edge.from)?.push(edge.to);
    }
  }

  // Normalize outgoing counts (teleport for dangling nodes)
  const outCounts = new Map<string, number>();
  for (const path of nodePaths) {
    const outs = outgoing.get(path) ?? [];
    outCounts.set(path, outs.length > 0 ? outs.length : n);
  }

  // Initial rank: uniform, or boosted for seeds
  const ranks = new Map<string, number>();
  const base = 1 / n;
  for (const path of nodePaths) {
    ranks.set(path, seeds?.has(path) ? base * 3 : base);
  }
  normalizeMap(ranks);

  // Personalization vector: uniform, or boosted for seeds
  const personal = new Map<string, number>();
  for (const path of nodePaths) {
    personal.set(path, seeds?.has(path) ? base * 3 : base);
  }
  normalizeMap(personal);

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();
    for (const path of nodePaths) {
      let sum = 0;
      for (const edge of graph.edges) {
        if (edge.to === path && edge.kind === "imports") {
          const outCount = outCounts.get(edge.from) ?? n;
          sum += (ranks.get(edge.from) ?? 0) / outCount;
        }
      }
      // Dangling node: distribute rank uniformly
      const outs = outgoing.get(path) ?? [];
      if (outs.length === 0) {
        sum += (ranks.get(path) ?? 0) / n;
      }
      newRanks.set(path, (1 - damping) * (personal.get(path) ?? base) + damping * sum);
    }
    normalizeMap(newRanks);

    // Check convergence
    let diff = 0;
    for (const path of nodePaths) {
      diff += Math.abs((newRanks.get(path) ?? 0) - (ranks.get(path) ?? 0));
    }
    for (const path of nodePaths) ranks.set(path, newRanks.get(path) ?? 0);
    if (diff < epsilon) break;
  }
  return ranks;
}

function normalizeMap(map: Map<string, number>): void {
  let sum = 0;
  for (const v of map.values()) sum += v;
  if (sum === 0) return;
  for (const key of map.keys()) {
    map.set(key, (map.get(key) ?? 0) / sum);
  }
}

function buildNativeWikiDimensions(input: {
  index: NativeWikiIndex;
  graph: NativeWikiGraph;
  contents: Map<string, string>;
}): NativeWikiDimensions {
  const outgoing = new Map<string, NativeWikiGraphEdge[]>();
  const incoming = new Map<string, NativeWikiGraphEdge[]>();
  for (const edge of input.graph.edges) {
    pushMapValue(outgoing, edge.from, edge);
    pushMapValue(incoming, edge.to, edge);
  }
  const unresolved = new Map<string, string[]>();
  for (const entry of input.graph.unresolvedImports) {
    pushMapValue(unresolved, entry.from, entry.specifier);
  }
  return {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: input.index.generatedAt,
    files: input.index.files.map((file) =>
      buildNativeFileDimensions({
        file,
        content: input.contents.get(file.path) ?? "",
        outgoing: outgoing.get(file.path) ?? [],
        incoming: incoming.get(file.path) ?? [],
        unresolvedImports: unresolved.get(file.path) ?? [],
      }),
    ),
  };
}

function buildNativeFileDimensions(input: {
  file: NativeWikiFileEntry;
  content: string;
  outgoing: NativeWikiGraphEdge[];
  incoming: NativeWikiGraphEdge[];
  unresolvedImports: string[];
}): NativeWikiFileDimensions {
  return {
    path: input.file.path,
    language: input.file.language,
    dimensions: {
      structure: nativeStructureSignals(input.file),
      symbols: nativeSymbolSignals(input.file),
      apis: nativeApiSignals(input.file, input.content),
      workflows: nativeWorkflowSignals(input.file, input.content),
      config: nativeConfigSignals(input.file, input.content),
      tests: nativeTestSignals(input.file, input.content),
      docs: nativeDocSignals(input.file),
      relations: nativeRelationSignals(input.file, input.outgoing, input.incoming, input.unresolvedImports),
    },
  };
}

function nativeStructureSignals(file: NativeWikiFileEntry) {
  const signals = new Set<string>([`language:${file.language}`]);
  const parts = file.path.split("/");
  if (parts.length > 1) signals.add(`root:${parts[0]}`);
  const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  signals.add(`dir:${dir}`);
  const ext = extname(file.path).toLowerCase();
  if (ext) signals.add(`ext:${ext}`);
  return sortedSignals(signals);
}

function nativeSymbolSignals(file: NativeWikiFileEntry) {
  const signals = new Set<string>();
  for (const name of file.exports) signals.add(`export:${name}`);
  return sortedSignals(signals);
}

function nativeApiSignals(file: NativeWikiFileEntry, content: string) {
  const signals = new Set<string>();
  if (file.path === "bin/gxpm" || file.path === "scripts/gxpm.ts") signals.add("cli:gxpm");
  collectRegex(content, /\bgxpm(?:\s+[a-z][\w-]*){1,3}/g, signals, undefined, "cli:");
  collectRegex(content, /\b(?:GET|POST|PUT|PATCH|DELETE)\s+["'`]([^"'`]+)["'`]/g, signals, undefined, "http:");
  collectRegex(content, /\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g, signals, undefined, "http:");
  return sortedSignals(signals);
}

function nativeWorkflowSignals(file: NativeWikiFileEntry, content: string) {
  const signals = new Set<string>();
  const path = file.path.toLowerCase();
  const workflowTokens = ["phase", "gate", "hook", "workflow", "transition", "triage", "dispatch", "verify", "qa", "land"];
  for (const token of workflowTokens) {
    if (path.includes(token)) signals.add(`path:${token}`);
  }
  if (path.startsWith(".githooks/") || path.includes("/hooks/")) signals.add("path:hook");
  for (const token of workflowTokens) {
    if (new RegExp(`\\b${token}\\b`, "i").test(content)) signals.add(`content:${token}`);
  }
  return sortedSignals(signals);
}

function nativeConfigSignals(file: NativeWikiFileEntry, content: string) {
  const signals = new Set<string>();
  const path = file.path.toLowerCase();
  if (path.includes("config")) signals.add("path:config");
  if (["json", "toml", "yaml"].includes(file.language)) signals.add(`format:${file.language}`);
  collectRegex(content, /\bprocess\.env\.([A-Z0-9_]+)/g, signals, undefined, "env:");
  collectRegex(content, /\b([A-Z][A-Z0-9_]{2,})\b/g, signals, undefined, "constant:");
  return sortedSignals(signals);
}

function nativeTestSignals(file: NativeWikiFileEntry, content: string) {
  const signals = new Set<string>();
  if (file.path.startsWith("test/") || /\.test\.[jt]sx?$/.test(file.path)) signals.add("path:test");
  if (/\bdescribe\s*\(/.test(content)) signals.add("runner:describe");
  if (/\btest\s*\(/.test(content)) signals.add("runner:test");
  return sortedSignals(signals);
}

function nativeDocSignals(file: NativeWikiFileEntry) {
  const signals = new Set<string>();
  const path = file.path.toLowerCase();
  if (path === "readme.md") signals.add("path:readme");
  if (path.startsWith("docs/")) signals.add("path:docs");
  if (file.language === "markdown") signals.add("format:markdown");
  for (const heading of file.headings) signals.add(`heading:${heading}`);
  return sortedSignals(signals);
}

function nativeRelationSignals(
  file: NativeWikiFileEntry,
  outgoing: NativeWikiGraphEdge[],
  incoming: NativeWikiGraphEdge[],
  unresolvedImports: string[],
) {
  const signals = new Set<string>();
  for (const edge of outgoing) signals.add(`imports:${edge.to}`);
  for (const edge of incoming) signals.add(`imported-by:${edge.from}`);
  for (const specifier of unresolvedImports) signals.add(`unresolved:${specifier}`);
  for (const specifier of file.imports.filter((specifier) => !specifier.startsWith("."))) {
    signals.add(`external:${specifier}`);
  }
  return sortedSignals(signals);
}

function sortedSignals(values: Set<string>) {
  return [...values].sort();
}

function listNativeRepoFiles(root: string) {
  const files = gitTrackedRepoFiles(root) ?? fallbackNativeRepoFiles(root);
  return files
    .filter((file) => {
      if (isNativeSkippedRepoPath(toRepoPath(root, file))) return false;
      const ext = extname(file).toLowerCase();
      if (!NATIVE_TEXT_EXTENSIONS.has(ext)) return false;
      try {
        if (statSync(file).size > NATIVE_MAX_FILE_BYTES) return false;
      } catch {
        return false;
      }
      if (ext === "" && !isLikelyTextFile(file)) return false;
      return true;
    })
    .sort((a, b) => toRepoPath(root, a).localeCompare(toRepoPath(root, b)));
}

function isNativeSkippedRepoPath(repoPath: string) {
  const firstSegment = normalizeRepoPath(repoPath).split("/")[0];
  return NATIVE_SKIP_DIRS.has(firstSegment);
}

function fallbackNativeRepoFiles(root: string) {
  const files: string[] = [];
  walkNativeRepoFiles(root, (file) => files.push(file));
  return files;
}

function gitTrackedRepoFiles(root: string) {
  const result = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return result.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((path) => join(root, path))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

function summarizeNativeFile(root: string, file: string, contents?: Map<string, string>): NativeWikiFileEntry {
  const content = safeRead(file);
  const stat = statSync(file);
  const repoPath = toRepoPath(root, file);
  contents?.set(repoPath, content);
  return {
    path: repoPath,
    language: languageForPath(repoPath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    lineCount: countLines(content),
    exports: extractExports(content),
    imports: extractImports(content),
    headings: extractMarkdownHeadings(content),
    symbols: extractNativeSymbols(repoPath, content),
    contentHash: sha256Hex(content),
  };
}

function readWikiConfig(root: string): NativeWikiConfig {
  const path = join(root, NATIVE_WIKI_CONFIG_PATH);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const candidate = raw as Record<string, unknown>;
    const config: NativeWikiConfig = {};
    if (Array.isArray(candidate.repo_notes)) {
      config.repo_notes = candidate.repo_notes.filter((v): v is string => typeof v === "string");
    }
    if (Array.isArray(candidate.priority_dirs)) {
      config.priority_dirs = candidate.priority_dirs.filter((v): v is string => typeof v === "string");
    }
    if (Array.isArray(candidate.exclude_from_map)) {
      config.exclude_from_map = candidate.exclude_from_map.filter((v): v is string => typeof v === "string");
    }
    return config;
  } catch {
    return {};
  }
}

function ensureWikiConfig(root: string): void {
  const path = join(root, NATIVE_WIKI_CONFIG_PATH);
  if (existsSync(path)) return;
  const template = {
    _comment: "gxpm native wiki configuration. Edit to customize wiki generation.",
    repo_notes: ["Add domain context notes here — they appear in Overview.md"],
    priority_dirs: ["core", "scripts"],
    exclude_from_map: ["tmp", "node_modules", "dist"],
  };
  writeFileSync(path, JSON.stringify(template, null, 2) + "\n", "utf8");
}

function writeNativeWikiDocs(
  root: string,
  state: NativeWikiState,
  index: NativeWikiIndex,
  graph: NativeWikiGraph,
  dimensions: NativeWikiDimensions,
  changedFiles?: string[],
) {
  ensureWikiConfig(root);
  const config = readWikiConfig(root);
  const previousGeneratedPaths = readNativeWikiDocManifest(root);
  const projectTopicClusters = buildNativeProjectTopicClusters(index, dimensions, config.priority_dirs);
  const changedSet = changedFiles ? new Set(changedFiles) : null;

  const excludeSet = new Set(config.exclude_from_map ?? []);

  const docEntries: Array<readonly [string, () => string]> = [
    ["Overview.md", () => renderNativeOverview(state, index, graph, config)],
    ["File-Index.md", () => renderNativeFileIndex(index)],
    ["Code-Graph.md", () => renderNativeCodeGraph(graph)],
    ["Project-Topics.md", () => renderNativeProjectTopics(index, graph, dimensions, projectTopicClusters)],
    ["Architecture-Diagram.md", () => renderNativeArchitectureDiagram(graph)],
    ...projectTopicClusters.map(
      (cluster) => [nativeProjectTopicFileName(cluster.rule), () => renderNativeProjectTopicPage(cluster, graph)] as const,
    ),
    ...NATIVE_WIKI_TOPICS.map((topic) => [topic.fileName, () => renderNativeTopicDoc(topic, index, graph)] as const),
  ].filter(([name]) => {
    for (const pattern of excludeSet) {
      if (name === pattern || name.startsWith(pattern.replace(/\/$/, "") + "/")) return false;
    }
    return true;
  });

  const docs: Array<readonly [string, string]> = docEntries.map(([name, renderer]) => {
    if (changedSet && !isDocAffected(name, changedSet, projectTopicClusters)) {
      const existingPath = join(root, NATIVE_WIKI_CONTENT_ROOT, name);
      const existing = safeRead(existingPath);
      if (existing) return [name, existing] as const;
    }
    return [name, renderer()] as const;
  });

  const paths: string[] = [];
  for (const [name, content] of docs) {
    const path = join(root, NATIVE_WIKI_CONTENT_ROOT, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    paths.push(toRepoPath(root, path));
  }
  writeModuleTreeJson(root, state, index);
  pruneStaleNativeWikiDocs(root, previousGeneratedPaths, paths);
  writeNativeWikiDocManifest(root, state, index, graph, dimensions, paths);
  return paths;
}

function isDocAffected(
  docName: string,
  changedSet: Set<string>,
  projectTopicClusters: NativeWikiProjectTopicCluster[],
): boolean {
  // Global docs are always affected
  if (["Overview.md", "File-Index.md", "Code-Graph.md", "Project-Topics.md"].includes(docName)) {
    return true;
  }

  // Project topic pages: affected if any matched file changed
  const topicCluster = projectTopicClusters.find((c) => nativeProjectTopicFileName(c.rule) === docName);
  if (topicCluster) {
    return topicCluster.files.some((entry) => changedSet.has(entry.file.path));
  }

  // Fixed topic docs: affected if sourcePaths or sourcePrefixes intersect changed files
  const fixedTopic = NATIVE_WIKI_TOPICS.find((t) => t.fileName === docName);
  if (fixedTopic) {
    return changedSetHasTopicMatch(changedSet, fixedTopic);
  }

  return true;
}

function changedSetHasTopicMatch(changedSet: Set<string>, topic: NativeWikiTopic): boolean {
  for (const path of changedSet) {
    if (topic.sourcePaths.includes(path)) return true;
    if (topic.sourcePrefixes?.some((prefix) => path.startsWith(prefix))) return true;
  }
  return false;
}

function readNativeWikiDocManifest(root: string) {
  const path = join(root, NATIVE_WIKI_DOC_MANIFEST_PATH);
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { docs?: unknown };
    return Array.isArray(value.docs) ? value.docs.filter((doc): doc is string => typeof doc === "string") : [];
  } catch {
    return [];
  }
}

function writeModuleTreeJson(root: string, state: NativeWikiState, index: NativeWikiIndex) {
  const rootNode: NativeWikiModuleTreeNode = { name: ".", type: "directory", children: [], fileCount: 0 };
  for (const file of index.files) {
    const parts = file.path.split("/");
    let current = rootNode;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current.children = current.children ?? [];
        current.children.push({ name: part, type: "file" });
        current.fileCount = (current.fileCount ?? 0) + 1;
      } else {
        current.children = current.children ?? [];
        let next = current.children.find((c) => c.name === part && c.type === "directory");
        if (!next) {
          next = { name: part, type: "directory", children: [], fileCount: 0 };
          current.children.push(next);
        }
        current.fileCount = (current.fileCount ?? 0) + 1;
        current = next;
      }
    }
  }
  const tree: NativeWikiModuleTree = {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: state.generatedAt,
    root: rootNode,
  };
  writeJson(join(root, NATIVE_WIKI_MODULE_TREE_PATH), tree);
}

function writeNativeWikiDocManifest(
  root: string,
  state: NativeWikiState,
  index: NativeWikiIndex,
  graph: NativeWikiGraph,
  dimensions: NativeWikiDimensions,
  generatedDocPaths: string[],
) {
  writeJson(join(root, NATIVE_WIKI_DOC_MANIFEST_PATH), {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt: state.generatedAt,
    indexedFiles: index.files.length,
    graphEdges: graph.edges.length,
    dimensionedFiles: dimensions.files.length,
    docs: generatedDocPaths,
  });
}

function pruneStaleNativeWikiDocs(root: string, previousGeneratedPaths: string[], generatedDocPaths: string[]) {
  const previousGenerated = new Set(previousGeneratedPaths);
  const generated = new Set(generatedDocPaths);
  walkFiles(join(root, NATIVE_WIKI_CONTENT_ROOT), (file) => {
    if (!file.endsWith(".md")) return;
    const repoPath = toRepoPath(root, file);
    if (previousGenerated.has(repoPath) && !generated.has(repoPath)) rmSync(file, { force: true });
  });
}

function renderNativeOverview(state: NativeWikiState, index: NativeWikiIndex, graph: NativeWikiGraph, config?: NativeWikiConfig) {
  const languages = countBy(index.files, (file) => file.language)
    .map(([language, count]) => `- ${language}: ${count}`)
    .join("\n");
  const highSignalFiles = index.files
    .filter((file) => file.exports.length > 0 || file.headings.length > 0)
    .slice(0, 20)
    .map((file) => `- [${file.path}](${nativeFileUrl(file.path)})`)
    .join("\n");
  const repoNotesSection =
    config?.repo_notes && config.repo_notes.length > 0
      ? ["## Repo Notes", "", ...config.repo_notes.map((note) => `> ${note.replace(/\n/g, "\n> ")}`), ""]
      : [];
  return [
    "# GXPM Wiki Overview",
    "",
    `Generated: ${state.generatedAt}`,
    `Base commit: ${state.baseCommit ?? "unknown"}`,
    `Indexed files: ${index.files.length}`,
    `Import edges: ${graph.edges.length}`,
    "",
    ...repoNotesSection,
    "## Languages",
    "",
    languages || "- none",
    "",
    "## Navigation",
    "",
    "- [Project Topics](file://.gxpm/wiki/content/Project-Topics.md)",
    "- [File Index](file://.gxpm/wiki/content/File-Index.md)",
    "- [Code Graph](file://.gxpm/wiki/content/Code-Graph.md)",
    "- [Architecture Diagram](file://.gxpm/wiki/content/Architecture-Diagram.md)",
    "",
    "## High Signal Files",
    "",
    highSignalFiles || "- none",
    "",
  ].join("\n");
}

function renderNativeFileIndex(index: NativeWikiIndex) {
  const rows = index.files
    .slice(0, 200)
    .map((file) => `| [${file.path}](${nativeFileUrl(file.path)}) | ${file.language} | ${file.exports.join(", ")} |`);
  return [
    "# File Index",
    "",
    "| File | Language | Exports |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function renderNativeCodeGraph(graph: NativeWikiGraph) {
  const edges = graph.edges
    .slice(0, 200)
    .map((edge) => `- [${edge.from}](${nativeFileUrl(edge.from)}) -> [${edge.to}](${nativeFileUrl(edge.to)})`);
  return ["# Code Graph", "", ...edges, ""].join("\n");
}

function renderNativeArchitectureDiagram(graph: NativeWikiGraph) {
  const fileSet = new Set(graph.nodes.map((n) => n.path));
  const mermaidEdges = graph.edges
    .filter((edge) => fileSet.has(edge.from) && fileSet.has(edge.to))
    .slice(0, 150)
    .map((edge) => {
      const from = edge.from.replace(/[^a-zA-Z0-9_]/g, "_");
      const to = edge.to.replace(/[^a-zA-Z0-9_]/g, "_");
      return `    ${from}["${escapeMarkdownCell(edge.from)}"] --> ${to}["${escapeMarkdownCell(edge.to)}"]`;
    });
  return [
    "# Architecture Diagram",
    "",
    "```mermaid",
    "flowchart LR",
    ...mermaidEdges,
    "```",
    "",
  ].join("\n");
}

interface NativeWikiTopic {
  fileName: string;
  title: string;
  summary: string;
  keywords: string[];
  sourcePaths: string[];
  sourcePrefixes?: string[];
  mermaid?: string;
}

type NativeWikiDimensionKey = keyof NativeWikiFileDimensions["dimensions"];

interface NativeWikiProjectTopicRule {
  title: string;
  summary: string;
  hints: string[];
  dimensionKeys?: NativeWikiDimensionKey[];
}

interface NativeWikiProjectTopicFile {
  file: NativeWikiFileEntry;
  score: number;
  signals: string[];
}

interface NativeWikiProjectTopicCluster {
  rule: NativeWikiProjectTopicRule;
  files: NativeWikiProjectTopicFile[];
}

const NATIVE_WIKI_PROJECT_TOPIC_FILE = "Project-Topics.md";

const NATIVE_WIKI_PROJECT_TOPIC_RULES: NativeWikiProjectTopicRule[] = [
  {
    title: "Phase And Gate System",
    summary: "Issue lifecycle, phase gates, transitions, and phase-specific artifacts inferred from workflow signals.",
    hints: ["phase", "gate", "transition", "triage", "dispatch", "verify", "qa", "land"],
    dimensionKeys: ["workflows"],
  },
  {
    title: "CLI Command Surface",
    summary: "User-facing gxpm commands and command handlers inferred from CLI and API signals.",
    hints: ["cli:gxpm", "scripts/gxpm", "bin/gxpm", "command"],
    dimensionKeys: ["apis"],
  },
  {
    title: "Hook Governance",
    summary: "Git and Codex hook surfaces inferred from hook paths, workflow signals, and template locations.",
    hints: ["hook", ".githooks", "pre-commit", "pre-push", "post-merge", "codex-hooks"],
    dimensionKeys: ["workflows"],
  },
  {
    title: "Configuration And Workspace",
    summary: "Configuration, worktree, workspace, and environment behavior inferred from config signals.",
    hints: ["config", "worktree", "workspace", "env:"],
    dimensionKeys: ["config"],
  },
  {
    title: "Host Adapters",
    summary: "Claude, Codex, and host installation boundaries inferred from host paths and adapter names.",
    hints: ["hosts/", "adapter", "claude", "codex"],
    dimensionKeys: ["structure", "symbols"],
  },
  {
    title: "Tests And Verification",
    summary: "Test and validation coverage inferred from test paths and runner signals.",
    hints: ["path:test", "runner:test", "runner:describe", "verify", "test/"],
    dimensionKeys: ["tests"],
  },
  {
    title: "Docs And Research",
    summary: "Architecture, governance, roadmap, and research material inferred from documentation signals.",
    hints: ["path:docs", "format:markdown", "readme", "architecture", "research", "roadmap"],
    dimensionKeys: ["docs"],
  },
];

const NATIVE_WIKI_TOPICS: NativeWikiTopic[] = [
  {
    fileName: "Phase-Lifecycle.md",
    title: "Phase Lifecycle",
    summary: "How gxpm moves issue work through phase gates and artifact-backed transitions.",
    keywords: ["phase", "phases", "gate", "gates", "transition", "workflow", "lifecycle", "verify", "land"],
    sourcePaths: [
      "core/state.ts",
      "core/phase-gates.ts",
      "core/phase-artifact.ts",
      "core/triage.ts",
      "core/plan.ts",
      "core/dispatch.ts",
      "core/implement.ts",
      "core/ac-check.ts",
      "core/self-review.ts",
      "core/ship.ts",
      "core/pr-check.ts",
      "core/verify.ts",
      "core/qa.ts",
      "core/land.ts",
      "scripts/phase-artifact-commands.ts",
    ],
    mermaid: renderPhaseLifecycleDiagram(),
  },
  {
    fileName: "Artifact-System.md",
    title: "Artifact System",
    summary: "How gxpm stores phase evidence, acceptance contracts, checkpoints, and wiki context.",
    keywords: ["artifact", "artifacts", "evidence", "acceptance", "checkpoint", "context", "memory"],
    sourcePaths: [
      "core/artifacts.ts",
      "core/phase-artifact.ts",
      "core/state.ts",
      "scripts/phase-artifact-commands.ts",
    ],
  },
  {
    fileName: "Hook-Governance.md",
    title: "Hook Governance",
    summary: "How shell and Codex hooks guard branches, sessions, generated files, and workflow prompts.",
    keywords: ["hook", "hooks", "governance", "branch", "session", "codex", "pre-commit"],
    sourcePaths: [
      "core/gate.ts",
      "scripts/install-hooks.ts",
      "scripts/install-codex-hooks.ts",
      "templates/hooks/gxpm-commit-msg",
      "templates/hooks/gxpm-post-merge",
      "templates/hooks/gxpm-pre-commit",
      "templates/hooks/gxpm-pre-push",
      "templates/codex-hooks/pre-tool-use.sh",
      "templates/codex-hooks/session-start.sh",
      "templates/codex-hooks/user-prompt-submit.sh",
    ],
    sourcePrefixes: [".githooks/", "templates/hooks/", "templates/codex-hooks/"],
  },
  {
    fileName: "Config-Worktree.md",
    title: "Config And Worktree",
    summary: "How gxpm resolves repo config, workspace runtime behavior, and worktree policy.",
    keywords: ["config", "configuration", "worktree", "workspace", "branch", "main"],
    sourcePaths: [
      "core/config.ts",
      "core/workspace-runtime.ts",
      "AGENTS.md",
      "docs/governance/development-contract.md",
    ],
  },
  {
    fileName: "Native-Wiki.md",
    title: "Native Wiki",
    summary: "How gxpm initializes, updates, queries, and evaluates its first-party wiki.",
    keywords: ["wiki", "native", "index", "query", "context", "knowledge"],
    sourcePaths: [
      "core/wiki.ts",
      "core/wiki-native.ts",
      "test/wiki.test.ts",
      "docs/governance/development-contract.md",
    ],
  },
  {
    fileName: "CLI-Surface.md",
    title: "CLI Surface",
    summary: "How gxpm exposes issue, artifact, wiki, hook, and workflow commands to agents.",
    keywords: ["cli", "command", "commands", "gxpm", "bin", "surface", "issue"],
    sourcePaths: ["scripts/gxpm.ts", "bin/gxpm", "README.md", "package.json"],
  },
];

function renderNativeProjectTopics(
  index: NativeWikiIndex,
  graph: NativeWikiGraph,
  dimensions: NativeWikiDimensions,
  projectTopicClusters?: NativeWikiProjectTopicCluster[],
) {
  const clusters = projectTopicClusters ?? buildNativeProjectTopicClusters(index, dimensions);
  const clusterSections = clusters.flatMap((cluster) => renderNativeProjectTopicCluster(cluster));
  const signalRows = renderNativeDimensionSignalSummary(dimensions);
  const hubRows = renderNativeGraphHubSummary(index, graph);

  return [
    "# Project Topics",
    "",
    "Project-derived navigation generated from gxpm native dimensions. External wiki content is not read or copied for this page.",
    "",
    "## Inferred Topic Clusters",
    "",
    ...(clusterSections.length > 0 ? clusterSections : ["- No topic clusters inferred from current dimensions.", ""]),
    "## Top Dimension Signals",
    "",
    "| Signal | Files |",
    "| --- | ---: |",
    ...(signalRows.length > 0 ? signalRows : ["| - | 0 |"]),
    "",
    "## Import Hubs",
    "",
    "| File | Imports | Imported By |",
    "| --- | ---: | ---: |",
    ...(hubRows.length > 0 ? hubRows : ["| - | 0 | 0 |"]),
    "",
  ].join("\n");
}

function nativeProjectTopicFileName(rule: NativeWikiProjectTopicRule) {
  return `${NATIVE_WIKI_PROJECT_TOPIC_DIR}/${nativeProjectTopicSlug(rule.title)}.md`;
}

function nativeProjectTopicDocPath(rule: NativeWikiProjectTopicRule) {
  return `${NATIVE_WIKI_CONTENT_ROOT}/${nativeProjectTopicFileName(rule)}`;
}

function nativeProjectTopicSlug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "topic"
  );
}

function buildNativeProjectTopicClusters(
  index: NativeWikiIndex,
  dimensions: NativeWikiDimensions,
  priorityDirs?: string[],
) {
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  const prioritySet = new Set((priorityDirs ?? []).map((d) => d.replace(/\/$/, "")));
  return NATIVE_WIKI_PROJECT_TOPIC_RULES.map((rule) => {
    const files = dimensions.files
      .map((entry) => {
        const file = byPath.get(entry.path);
        if (!file) return null;
        let score = scoreNativeProjectTopicFile(rule, entry);
        if (score <= 0) return null;
        for (const prefix of prioritySet) {
          if (entry.path.startsWith(prefix + "/")) {
            score += 5;
            break;
          }
        }
        return {
          file,
          score,
          signals: matchingNativeProjectTopicSignals(rule, entry),
        };
      })
      .filter((entry): entry is NativeWikiProjectTopicFile => entry !== null)
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, 12);
    return { rule, files };
  }).filter((cluster) => cluster.files.length > 0);
}

function renderNativeProjectTopicCluster(cluster: NativeWikiProjectTopicCluster) {
  const rows = cluster.files.map((entry) => {
    const signals = entry.signals.slice(0, 8).map(escapeMarkdownCell).join(", ");
    return `| [${escapeMarkdownCell(entry.file.path)}](${nativeSourceLink(entry.file)}) | ${entry.score} | ${signals || "-"} |`;
  });
  return [
    `### [${cluster.rule.title}](${nativeFileUrl(nativeProjectTopicDocPath(cluster.rule))})`,
    "",
    cluster.rule.summary,
    "",
    "| File | Score | Matched Signals |",
    "| --- | ---: | --- |",
    ...rows,
    "",
  ];
}

function renderNativeProjectTopicPage(cluster: NativeWikiProjectTopicCluster, graph: NativeWikiGraph) {
  const sourceLines = cluster.files.map((entry) => `- [${entry.file.path}](${nativeSourceLink(entry.file)})`);
  const rows = cluster.files.map((entry) => {
    const signals = entry.signals.slice(0, 12).map(escapeMarkdownCell).join(", ");
    return `| [${escapeMarkdownCell(entry.file.path)}](${nativeSourceLink(entry.file)}) | ${entry.file.language} | ${entry.score} | ${signals || "-"} |`;
  });
  const fileSet = new Set(cluster.files.map((entry) => entry.file.path));
  const edges = graph.edges
    .filter((edge) => fileSet.has(edge.from) || fileSet.has(edge.to))
    .slice(0, 30)
    .map((edge) => `- [${edge.from}](${nativeFileUrl(edge.from)}) -> [${edge.to}](${nativeFileUrl(edge.to)})`);

  return [
    `# ${cluster.rule.title}`,
    "",
    cluster.rule.summary,
    "",
    "## Sources",
    "",
    ...(sourceLines.length > 0 ? sourceLines : ["- No matching indexed source files."]),
    "",
    "## Matched Files",
    "",
    "| File | Language | Score | Matched Signals |",
    "| --- | --- | ---: | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | 0 | - |"]),
    "",
    "## Related Imports",
    "",
    ...(edges.length > 0 ? edges : ["- none"]),
    "",
    "## Navigation",
    "",
    "- [Project Topics](file://.gxpm/wiki/content/Project-Topics.md)",
    "- [File Index](file://.gxpm/wiki/content/File-Index.md)",
    "- [Code Graph](file://.gxpm/wiki/content/Code-Graph.md)",
    "",
  ].join("\n");
}

function scoreNativeProjectTopicFile(rule: NativeWikiProjectTopicRule, entry: NativeWikiFileDimensions) {
  let hintScore = 0;
  const searchText = nativeProjectTopicSearchText(entry);
  for (const hint of rule.hints) {
    const normalized = hint.toLowerCase();
    if (entry.path.toLowerCase().includes(normalized)) hintScore += 5;
    if (searchText.includes(normalized)) hintScore += 3;
  }
  if (hintScore === 0) return 0;
  let dimensionScore = 0;
  for (const key of rule.dimensionKeys ?? []) {
    dimensionScore += entry.dimensions[key].length;
  }
  return hintScore + Math.min(dimensionScore, 8);
}

function matchingNativeProjectTopicSignals(rule: NativeWikiProjectTopicRule, entry: NativeWikiFileDimensions) {
  const hints = rule.hints.map((hint) => hint.toLowerCase());
  const signals = flattenNativeDimensionSignals(entry);
  const matched = signals.filter((signal) => {
    const lower = signal.toLowerCase();
    return hints.some((hint) => lower.includes(hint));
  });
  if (matched.length > 0) return matched;
  const scoped = signals.filter((signal) =>
    (rule.dimensionKeys ?? []).some((key) => signal.startsWith(`${key}:`)),
  );
  if (scoped.length > 0) return scoped;
  return signals;
}

function nativeProjectTopicSearchText(entry: NativeWikiFileDimensions) {
  return [entry.path, ...flattenNativeDimensionSignals(entry)].join(" ").toLowerCase();
}

function flattenNativeDimensionSignals(entry: NativeWikiFileDimensions) {
  return (Object.entries(entry.dimensions) as Array<[NativeWikiDimensionKey, string[]]>)
    .flatMap(([key, signals]) => signals.map((signal) => `${key}:${signal}`));
}

function renderNativeDimensionSignalSummary(dimensions: NativeWikiDimensions) {
  const counts = new Map<string, number>();
  for (const entry of dimensions.files) {
    for (const signal of flattenNativeDimensionSignals(entry)) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([signal, count]) => `| ${escapeMarkdownCell(signal)} | ${count} |`);
}

function renderNativeGraphHubSummary(index: NativeWikiIndex, graph: NativeWikiGraph) {
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  return index.files
    .map((file) => ({
      file,
      outgoing: outgoing.get(file.path) ?? 0,
      incoming: incoming.get(file.path) ?? 0,
    }))
    .filter((entry) => entry.outgoing > 0 || entry.incoming > 0)
    .sort(
      (a, b) =>
        b.outgoing + b.incoming - (a.outgoing + a.incoming) ||
        b.incoming - a.incoming ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, 15)
    .map(
      (entry) =>
        `| [${escapeMarkdownCell(entry.file.path)}](${nativeSourceLink(entry.file)}) | ${entry.outgoing} | ${entry.incoming} |`,
    );
}

function renderNativeTopicDoc(topic: NativeWikiTopic, index: NativeWikiIndex, graph: NativeWikiGraph) {
  const files = topicFiles(topic, index);
  const citeLines = files.map((file) => `- [${file.path}](${nativeSourceLink(file)})`);
  const rows = files.map((file) => {
    const signals = [...file.exports, ...file.headings].slice(0, 8).map(escapeMarkdownCell).join(", ");
    return `| [${escapeMarkdownCell(file.path)}](${nativeSourceLink(file)}) | ${file.language} | ${signals || "-"} |`;
  });
  const fileSet = new Set(files.map((file) => file.path));
  const edges = graph.edges
    .filter((edge) => fileSet.has(edge.from) || fileSet.has(edge.to))
    .slice(0, 30)
    .map((edge) => `- [${edge.from}](${nativeFileUrl(edge.from)}) -> [${edge.to}](${nativeFileUrl(edge.to)})`);

  return [
    `# ${topic.title}`,
    "",
    topic.summary,
    "",
    "## Sources",
    "",
    ...(citeLines.length > 0 ? citeLines : ["- No matching indexed source files."]),
    "",
    ...(topic.mermaid ? ["## Flow", "", "```mermaid", topic.mermaid, "```", ""] : []),
    "## Source Files",
    "",
    "| File | Language | Signals |",
    "| --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - |"]),
    "",
    "## Related Imports",
    "",
    ...(edges.length > 0 ? edges : ["- none"]),
    "",
  ].join("\n");
}

function topicFiles(topic: NativeWikiTopic, index: NativeWikiIndex) {
  return index.files
    .filter((file) => nativeTopicOwnsPath(topic, file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function nativeTopicOwnsPath(topic: NativeWikiTopic, path: string) {
  return topic.sourcePaths.includes(path) || (topic.sourcePrefixes ?? []).some((prefix) => path.startsWith(prefix));
}

function nativeSourceLink(file: NativeWikiFileEntry) {
  const endLine = Math.max(1, file.lineCount || 1);
  return `${nativeFileUrl(file.path)}#L1-L${endLine}`;
}

function nativeFileUrl(path: string) {
  return `file://${encodeFileUrlPath(path)}`;
}

function encodeFileUrlPath(path: string) {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

function decodeFileUrlPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function renderPhaseLifecycleDiagram() {
  const edges = GXPM_PHASES.slice(0, -1).map((phase, index) => `  ${phase} --> ${GXPM_PHASES[index + 1]}`);
  return ["flowchart LR", ...edges].join("\n");
}

function readNativeWikiIndex(root: string): NativeWikiIndex {
  const path = join(root, NATIVE_WIKI_INDEX_PATH);
  if (!existsSync(path)) {
    throw new Error("Native gxpm wiki index not found. Run `gxpm wiki init` first.");
  }
  return normalizeNativeWikiIndex(JSON.parse(readFileSync(path, "utf8")) as NativeWikiIndex);
}

function readNativeWikiStateIfPresent(root: string): NativeWikiState | null {
  const path = join(root, NATIVE_WIKI_STATE_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NativeWikiState;
  } catch {
    return null;
  }
}

function readNativeWikiIndexIfPresent(root: string): NativeWikiIndex | null {
  const path = join(root, NATIVE_WIKI_INDEX_PATH);
  if (!existsSync(path)) return null;
  try {
    return normalizeNativeWikiIndex(JSON.parse(readFileSync(path, "utf8")) as NativeWikiIndex);
  } catch {
    return null;
  }
}

function readNativeWikiGraphIfPresent(root: string): NativeWikiGraph | null {
  const path = join(root, NATIVE_WIKI_GRAPH_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NativeWikiGraph;
  } catch {
    return null;
  }
}

function readNativeWikiDimensionsIfPresent(root: string): NativeWikiDimensions | null {
  const path = join(root, NATIVE_WIKI_DIMENSIONS_PATH);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isNativeWikiDimensions(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function isNativeWikiDimensions(value: unknown): value is NativeWikiDimensions {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeWikiDimensions>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.provider === "gxpm" &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.files)
  );
}

function normalizeNativeWikiIndex(index: NativeWikiIndex): NativeWikiIndex {
  return {
    ...index,
    files: index.files.map((file) => ({
      ...file,
      lineCount: typeof file.lineCount === "number" ? file.lineCount : 0,
      contentHash: typeof file.contentHash === "string" ? file.contentHash : "",
    })),
  };
}

function listNativeWikiDocs(root: string) {
  const docs: string[] = [];
  walkFiles(join(root, NATIVE_WIKI_CONTENT_ROOT), (file) => {
    if (file.endsWith(".md")) docs.push(toRepoPath(root, file));
  });
  return docs.sort();
}

function changedNativeFiles(root: string, index: NativeWikiIndex) {
  const indexed = new Map(index.files.map((file) => [file.path, file]));
  const trackedPaths = listNativeRepoFiles(root).map((file) => toRepoPath(root, file));
  const tracked = new Set(trackedPaths);
  const changed = new Set<string>();
  for (const path of trackedPaths) {
    const indexedFile = indexed.get(path);
    if (!indexedFile) {
      changed.add(path);
      continue;
    }
    try {
      const stat = statSync(join(root, path));
      if (stat.size !== indexedFile.sizeBytes || Math.abs(stat.mtimeMs - indexedFile.mtimeMs) > 1) {
        changed.add(path);
        continue;
      }
      // If mtime/size match but contentHash is present, verify hash to catch
      // cases where mtime was preserved (e.g. git checkout, patch -p0)
      if (indexedFile.contentHash) {
        const content = safeRead(join(root, path));
        if (sha256Hex(content) !== indexedFile.contentHash) {
          changed.add(path);
        }
      }
    } catch {
      changed.add(path);
    }
  }
  for (const path of indexed.keys()) {
    if (!tracked.has(path)) changed.add(path);
  }
  return [...changed].sort();
}

function nativeWikiStatusPaths() {
  return {
    state: NATIVE_WIKI_STATE_PATH,
    index: NATIVE_WIKI_INDEX_PATH,
    graph: NATIVE_WIKI_GRAPH_PATH,
    dimensions: NATIVE_WIKI_DIMENSIONS_PATH,
    contentRoot: NATIVE_WIKI_CONTENT_ROOT,
  };
}

function nativeWikiStatusCommands() {
  return {
    init: "gxpm wiki init",
    update: "gxpm wiki update",
    query: "gxpm wiki query <text>",
    context: "gxpm wiki context <issue-id>",
  };
}

function suggestedNativeDocs(root: string, contextFiles: string[], tokens: string[] = []) {
  const allDocs = new Set(listNativeWikiDocs(root));
  const scoredTopicDocs = NATIVE_WIKI_TOPICS.map((topic, index) => ({
    path: `${NATIVE_WIKI_CONTENT_ROOT}/${topic.fileName}`,
    score: scoreNativeTopicSuggestion(topic, contextFiles, tokens),
    index,
  }))
    .filter((topic) => topic.score > 0 && allDocs.has(topic.path))
    .sort((a, b) => b.score - a.score || a.index - b.index || a.path.localeCompare(b.path));
  const strongTopicDocs = scoredTopicDocs.filter((topic) => topic.score >= 20).map((topic) => topic.path);
  const weakTopicDocs = scoredTopicDocs.filter((topic) => topic.score < 20).map((topic) => topic.path);

  const projectTopicDoc = `${NATIVE_WIKI_CONTENT_ROOT}/${NATIVE_WIKI_PROJECT_TOPIC_FILE}`;
  const projectTopicSuggestions = computeNativeProjectTopicSuggestions(
    readNativeWikiDimensionsIfPresent(root),
    contextFiles,
    allDocs,
  );
  const projectTopicDocs =
    allDocs.has(projectTopicDoc) && projectTopicSuggestions.hasMatches
      ? [projectTopicDoc]
      : [];

  const genericDocs: string[] = [];
  walkFiles(join(root, NATIVE_WIKI_CONTENT_ROOT), (file) => {
    if (!file.endsWith(".md")) return;
    const repoPath = toRepoPath(root, file);
    if (isNativeTopicDoc(repoPath) || repoPath.endsWith("/Overview.md")) return;
    const cited = extractCitedFiles(safeRead(file));
    if (cited.some((path) => contextFiles.includes(path))) genericDocs.push(repoPath);
  });

  const overview = allDocs.has(`${NATIVE_WIKI_CONTENT_ROOT}/Overview.md`)
    ? [`${NATIVE_WIKI_CONTENT_ROOT}/Overview.md`]
    : [];
  return dedupeBy(
    [
      ...strongTopicDocs,
      ...projectTopicSuggestions.paths,
      ...projectTopicDocs,
      ...weakTopicDocs,
      ...genericDocs.sort(),
      ...overview,
    ],
    (path) => path,
  );
}

function computeNativeProjectTopicSuggestions(
  dimensions: NativeWikiDimensions | null,
  contextFiles: string[],
  allDocs: Set<string>,
): { paths: string[]; hasMatches: boolean } {
  if (!dimensions || contextFiles.length === 0) return { paths: [], hasMatches: false };
  const contextFileSet = new Set(contextFiles);
  const scored = NATIVE_WIKI_PROJECT_TOPIC_RULES.map((rule, index) => ({
    path: nativeProjectTopicDocPath(rule),
    score: dimensions.files
      .filter((entry) => contextFileSet.has(entry.path))
      .reduce((sum, entry) => sum + scoreNativeProjectTopicFile(rule, entry), 0),
    index,
  })).filter((entry) => entry.score > 0);
  return {
    hasMatches: scored.length > 0,
    paths: scored
      .filter((entry) => allDocs.has(entry.path))
      .sort((a, b) => b.score - a.score || a.index - b.index || a.path.localeCompare(b.path))
      .map((entry) => entry.path),
  };
}

function nativeFileMatches(file: NativeWikiFileEntry, tokens: string[]) {
  const matches: Array<{ label: string; score: number }> = [];
  const path = file.path.toLowerCase();
  const exports = file.exports.join(" ").toLowerCase();
  const imports = file.imports.join(" ").toLowerCase();
  const headings = file.headings.join(" ").toLowerCase();
  const symbolNames = file.symbols.map((s) => s.name.toLowerCase()).join(" ");
  for (const token of tokens) {
    if (path.includes(token)) matches.push({ label: `path:${token}`, score: 5 });
    if (exports.includes(token)) matches.push({ label: `export:${token}`, score: 4 });
    if (headings.includes(token)) matches.push({ label: `heading:${token}`, score: 3 });
    if (symbolNames.includes(token)) matches.push({ label: `symbol:${token}`, score: 4 });
    if (imports.includes(token)) matches.push({ label: `import:${token}`, score: 1 });
  }
  return matches;
}

function scoreNativeTopicSuggestion(topic: NativeWikiTopic, contextFiles: string[], tokens: string[]) {
  let score = 0;
  for (const file of contextFiles) {
    if (nativeTopicOwnsPath(topic, file)) score += 20;
  }
  for (const token of tokens) {
    if (topic.keywords.includes(token)) score += 3;
    if (topic.sourcePaths.some((path) => path.toLowerCase().includes(token))) score += 1;
  }
  return score;
}

function isNativeTopicDoc(repoPath: string) {
  return NATIVE_WIKI_TOPICS.some((topic) => repoPath === `${NATIVE_WIKI_CONTENT_ROOT}/${topic.fileName}`);
}

function tokenizeQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function extractExports(content: string) {
  const exports = new Set<string>();
  collectRegex(content, /^\s*export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm, exports);
  collectRegex(content, /^\s*export\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z_$][\w$]*)?/gm, exports, "default");
  const namedExportRe = /^\s*export\s*\{([^}]+)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = namedExportRe.exec(content)) !== null) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name) exports.add(name);
    }
  }
  return [...exports].sort();
}

function extractImports(content: string) {
  const imports = new Set<string>();
  const staticImportRe = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRe = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  collectRegex(content, staticImportRe, imports);
  collectRegex(content, dynamicImportRe, imports);
  return [...imports].sort();
}

function extractMarkdownHeadings(content: string) {
  const headings = new Set<string>();
  collectRegex(content, /^#{1,6}\s+(.+)$/gm, headings);
  return [...headings].sort();
}

function extractNativeSymbols(filePath: string, content: string): Array<{ name: string; kind: string; line: number }> {
  const ext = extname(filePath);
  if (ext !== ".ts" && ext !== ".tsx" && ext !== ".js" && ext !== ".jsx" && ext !== ".mjs" && ext !== ".cjs") {
    return [];
  }
  let scriptKind: ts.ScriptKind;
  switch (ext) {
    case ".tsx": scriptKind = ts.ScriptKind.TSX; break;
    case ".jsx": scriptKind = ts.ScriptKind.JSX; break;
    case ".js": scriptKind = ts.ScriptKind.JS; break;
    default: scriptKind = ts.ScriptKind.TS; break;
  }
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: Array<{ name: string; kind: string; line: number }> = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name: node.name.text, kind: "function", line: pos.line + 1 });
    } else if (ts.isClassDeclaration(node) && node.name) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name: node.name.text, kind: "class", line: pos.line + 1 });
    } else if (ts.isInterfaceDeclaration(node)) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name: node.name.text, kind: "interface", line: pos.line + 1 });
    } else if (ts.isTypeAliasDeclaration(node)) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name: node.name.text, kind: "type", line: pos.line + 1 });
    } else if (ts.isEnumDeclaration(node)) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name: node.name.text, kind: "enum", line: pos.line + 1 });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const pos = source.getLineAndCharacterOfPosition(decl.getStart());
          const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
          symbols.push({ name: decl.name.text, kind: isConst ? "const" : "variable", line: pos.line + 1 });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return symbols;
}

function collectRegex(content: string, regex: RegExp, values: Set<string>, fallback?: string, prefix = "") {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const value = match[1]?.trim() || fallback || match[0]?.trim();
    if (value) values.add(`${prefix}${value}`);
  }
}

function resolveNativeImport(from: string, specifier: string, filePaths: Set<string>) {
  if (!specifier.startsWith(".")) return null;
  const base = normalizeRepoPath(join(dirname(from), specifier));
  const candidates = [
    base,
    ...NATIVE_IMPORT_RESOLVABLE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...NATIVE_IMPORT_RESOLVABLE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => filePaths.has(candidate)) ?? null;
}

function languageForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".md") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".sh") return "shell";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  return ext.replace(/^\./, "") || "text";
}

function currentGitCommit(root: string) {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.toString().trim();
  return value || null;
}

function walkNativeRepoFiles(dir: string, visit: (file: string) => void) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!NATIVE_SKIP_DIRS.has(entry.name)) walkNativeRepoFiles(join(dir, entry.name), visit);
    } else if (entry.isFile()) {
      visit(join(dir, entry.name));
    }
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function dedupeBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(value);
  }
  return result;
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function countBy<T>(values: T[], key: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const id = key(value);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function normalizeRepoPath(path: string) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function walkDirs(dir: string, visit: (dir: string) => void) {
  if (!existsSync(dir)) return;
  visit(dir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) walkDirs(join(dir, entry.name), visit);
  }
}

function walkFiles(dir: string, visit: (file: string) => void) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

function safeRead(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function isLikelyTextFile(path: string) {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const sample = Buffer.alloc(4096);
    const bytesRead = readSync(fd, sample, 0, sample.length, 0);
    const bytes = sample.subarray(0, bytesRead);
    for (const byte of bytes) {
      if (byte === 0) return false;
      if (byte < 7 || (byte > 13 && byte < 32)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function countLines(content: string) {
  if (content.length === 0) return 0;
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmedTrailingNewline.length === 0 ? 1 : trimmedTrailingNewline.split("\n").length;
}

function toRepoPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}
