import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { listArtifacts, readArtifact, type ArtifactType } from "./artifacts";
import { GXPM_PHASES, isGxpmPhase, readIssueState, type GxpmPhase } from "./state";

const QODER_REPOWIKI_ROOT = ".qoder/repowiki";
const QODER_STATE_PATH = ".gxpm/wiki/qoder.json";
const NATIVE_WIKI_ROOT = ".gxpm/wiki";
const NATIVE_WIKI_STATE_PATH = ".gxpm/wiki/state.json";
const NATIVE_WIKI_INDEX_PATH = ".gxpm/wiki/index/files.json";
const NATIVE_WIKI_GRAPH_PATH = ".gxpm/wiki/index/graph.json";
const NATIVE_WIKI_CONTENT_ROOT = ".gxpm/wiki/content";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOP_PAGES = 8;
const NATIVE_MAX_FILE_BYTES = 1_000_000;
const NATIVE_TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
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

export interface QoderWikiReminder {
  syncStale: boolean;
  reminderDue: boolean;
  reason: string;
  lastSyncAt?: string;
  lastReminderAt?: string;
  observedWikiUpdatedAt?: string;
}

export interface QoderWikiStatus {
  schemaVersion: 1;
  provider: "qoder";
  repoWikiRoot: string;
  detected: boolean;
  state: "absent" | "empty" | "present";
  contentRoots: string[];
  pageCount: number;
  topPages: WikiPageSummary[];
  observedWikiUpdatedAt?: string;
  progressiveRead: string[];
  reminder: QoderWikiReminder;
  commands: {
    status: string;
    markSync: string;
    markReminder: string;
  };
}

interface QoderWikiRecord {
  schemaVersion: 1;
  provider: "qoder";
  repoWikiRoot: string;
  lastSyncAt?: string;
  lastReminderAt?: string;
  note?: string;
}

export interface NativeWikiFileEntry {
  path: string;
  language: string;
  sizeBytes: number;
  mtimeMs: number;
  lineCount: number;
  exports: string[];
  imports: string[];
  headings: string[];
}

export interface NativeWikiIndex {
  schemaVersion: 1;
  provider: "gxpm";
  generatedAt: string;
  files: NativeWikiFileEntry[];
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

export interface NativeWikiState {
  schemaVersion: 1;
  provider: "gxpm";
  status: "idle" | "updating" | "queued";
  baseCommit: string | null;
  generatedAt: string;
  indexPath: string;
  graphPath: string;
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
  docs: string[];
  changedFiles: string[];
  paths: {
    state: string;
    index: string;
    graph: string;
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

export function getQoderWikiStatus(input: { root?: string; now?: Date } = {}): QoderWikiStatus {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();
  const repoWikiRoot = join(root, QODER_REPOWIKI_ROOT);
  const record = readQoderWikiRecord(root);

  if (!isDirectory(repoWikiRoot)) {
    return buildStatus({
      detected: false,
      state: "absent",
      contentRoots: [],
      pages: [],
      record,
      observedWikiUpdatedAt: undefined,
      now,
    });
  }

  const observedWikiUpdatedAt = newestKnownWikiTimestamp(root);
  const contentRoots = findContentRoots(root, repoWikiRoot);
  const pages = contentRoots.flatMap((contentRoot) => listMarkdownPages(root, contentRoot));
  return buildStatus({
    detected: true,
    state: pages.length === 0 ? "empty" : "present",
    contentRoots: contentRoots.map((path) => toRepoPath(root, path)),
    pages,
    record,
    observedWikiUpdatedAt,
    now,
  });
}

export function markQoderWikiSync(input: { root?: string; now?: Date; note?: string } = {}) {
  return writeQoderWikiRecord(input.root ?? process.cwd(), {
    lastSyncAt: (input.now ?? new Date()).toISOString(),
    note: input.note,
  });
}

export function markQoderWikiReminder(input: { root?: string; now?: Date; note?: string } = {}) {
  return writeQoderWikiRecord(input.root ?? process.cwd(), {
    lastReminderAt: (input.now ?? new Date()).toISOString(),
    note: input.note,
  });
}

export function initializeNativeWiki(input: { root?: string; now?: Date } = {}): NativeWikiBuildResult {
  return writeNativeWiki({ root: input.root, now: input.now, mode: "init" });
}

export function updateNativeWiki(input: { root?: string; now?: Date } = {}): NativeWikiBuildResult {
  return writeNativeWiki({ root: input.root, now: input.now, mode: "update" });
}

export function getNativeWikiStatus(input: { root?: string; now?: Date } = {}): NativeWikiStatus {
  const root = input.root ?? process.cwd();
  const currentCommit = currentGitCommit(root);
  const paths = nativeWikiStatusPaths();
  const commands = nativeWikiStatusCommands();
  const state = readNativeWikiStateIfPresent(root);
  const index = readNativeWikiIndexIfPresent(root);
  const graph = readNativeWikiGraphIfPresent(root);
  const docs = listNativeWikiDocs(root);

  const missingArtifacts: string[] = [];
  if (!state) missingArtifacts.push("state.json missing or unreadable");
  if (!index) missingArtifacts.push("index/files.json missing or unreadable");
  if (!graph) missingArtifacts.push("index/graph.json missing or unreadable");
  if (missingArtifacts.length > 0) {
    const hasAnyArtifacts = !!state || !!index || !!graph || docs.length > 0;
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
    docs,
    changedFiles,
    paths,
    commands,
  };
}

export function buildNativeWikiIndex(input: { root?: string; now?: Date } = {}): NativeWikiIndex {
  const root = input.root ?? process.cwd();
  const generatedAt = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    provider: "gxpm",
    generatedAt,
    files: listNativeRepoFiles(root).map((file) => summarizeNativeFile(root, file)),
  };
}

export function queryNativeWiki(input: {
  root?: string;
  query: string;
  limit?: number;
}): NativeWikiQueryResult {
  const root = input.root ?? process.cwd();
  const index = readNativeWikiIndex(root);
  const tokens = tokenizeQuery(input.query);
  const scored = index.files
    .map((file) => {
      const matches = nativeFileMatches(file, tokens);
      return {
        path: file.path,
        source: "file-index" as const,
        score: matches.reduce((sum, match) => sum + match.score, 0),
        matches: matches.map((match) => match.label),
      };
    })
    .filter((result) => result.score > 0)
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

export function getNativeWikiContextForIssue(input: {
  root?: string;
  issueId: string;
  phase?: GxpmPhase | string;
  limit?: number;
}): NativeWikiIssueContext {
  const root = input.root ?? process.cwd();
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
    results: result.results,
    contextFiles: result.contextFiles,
    suggestedDocs: result.suggestedDocs,
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

function buildStatus(input: {
  detected: boolean;
  state: QoderWikiStatus["state"];
  contentRoots: string[];
  pages: WikiPageSummary[];
  record: QoderWikiRecord | null;
  observedWikiUpdatedAt?: string;
  now: Date;
}): QoderWikiStatus {
  const topPages = input.pages.sort(comparePages).slice(0, MAX_TOP_PAGES);
  return {
    schemaVersion: 1,
    provider: "qoder",
    repoWikiRoot: QODER_REPOWIKI_ROOT,
    detected: input.detected,
    state: input.state,
    contentRoots: input.contentRoots,
    pageCount: input.pages.length,
    topPages,
    observedWikiUpdatedAt: input.observedWikiUpdatedAt,
    progressiveRead: progressiveReadSteps(input.detected, topPages),
    reminder: computeReminder(input.record, input.now, input.observedWikiUpdatedAt, input.detected),
    commands: {
      status: "gxpm wiki status",
      markSync: "gxpm wiki mark-sync --note <manual-qoder-resync-note>",
      markReminder: "gxpm wiki mark-reminder --note <reminder-note>",
    },
  };
}

function findContentRoots(root: string, repoWikiRoot: string): string[] {
  const roots: string[] = [];
  walkDirs(repoWikiRoot, (dir) => {
    if (dir.endsWith(`${sep}content`) || dir === join(repoWikiRoot, "content")) {
      roots.push(dir);
    }
  });
  const sortedRoots = roots.sort((a, b) => toRepoPath(root, a).localeCompare(toRepoPath(root, b)));
  return sortedRoots.filter(
    (candidate) => !sortedRoots.some((other) => other !== candidate && isDescendant(candidate, other)),
  );
}

function listMarkdownPages(root: string, contentRoot: string): WikiPageSummary[] {
  const files: string[] = [];
  walkFiles(contentRoot, (file) => {
    if (file.endsWith(".md")) files.push(file);
  });
  return files.sort().map((file) => summarizePage(root, file));
}

function summarizePage(root: string, file: string): WikiPageSummary {
  const content = safeRead(file);
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    path: toRepoPath(root, file),
    title: firstHeading || file.split(sep).pop()?.replace(/\.md$/, "") || toRepoPath(root, file),
    citedFiles: extractCitedFiles(content).slice(0, 8),
  };
}

export function extractCitedFiles(markdown: string): string[] {
  const files = new Set<string>();
  const re = /file:\/\/([^)#\s]+)(?:#[^)]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    files.add(match[1]);
  }
  return [...files].sort();
}

function comparePages(a: WikiPageSummary, b: WikiPageSummary) {
  const score = (page: WikiPageSummary) => {
    const depth = page.path.split("/").length;
    const hasCitations = page.citedFiles.length > 0 ? -5 : 0;
    const name = page.path.toLowerCase();
    const keyword =
      ["overview", "architecture", "hook", "config", "template", "guide", "quick"].some((k) =>
        name.includes(k),
      )
        ? -10
        : 0;
    return depth + hasCitations + keyword;
  };
  const delta = score(a) - score(b);
  return delta === 0 ? a.path.localeCompare(b.path) : delta;
}

function progressiveReadSteps(detected: boolean, topPages: WikiPageSummary[]) {
  if (!detected) {
    return ["No .qoder/repowiki directory detected; continue normal gxpm workflow."];
  }
  const pages = topPages.slice(0, 3).map((page) => `Read ${page.path}`);
  return [
    "Check gxpm issue state first, then use Qoder wiki before direct source reads.",
    ...pages,
    "Follow cited file anchors from the selected wiki pages into source code.",
    "After code changes, run gxpm wiki status and update or resync Qoder wiki if drift is reported.",
  ];
}

function computeReminder(
  record: QoderWikiRecord | null,
  now: Date,
  observedWikiUpdatedAt: string | undefined,
  detected: boolean,
): QoderWikiReminder {
  const lastSyncAt = record?.lastSyncAt;
  const lastReminderAt = record?.lastReminderAt;
  if (!detected) {
    return {
      syncStale: false,
      reminderDue: false,
      reason: "Qoder repo wiki is not present.",
      lastSyncAt,
      lastReminderAt,
      observedWikiUpdatedAt,
    };
  }

  const syncOlderThanWeek = isOlderThanWeek(lastSyncAt, now);
  const wikiUpdatedAfterSync = isAfter(observedWikiUpdatedAt, lastSyncAt);
  const wikiUpdatedAfterReminder = isAfter(observedWikiUpdatedAt, lastReminderAt);
  const syncStale = !lastSyncAt || syncOlderThanWeek || wikiUpdatedAfterSync;
  const reminderDue = syncStale && (isOlderThanWeek(lastReminderAt, now) || wikiUpdatedAfterReminder);
  let reason = "Qoder repo wiki sync evidence is current.";
  if (!lastSyncAt) {
    reason = "No manual Qoder wiki sync has been recorded in gxpm.";
  } else if (wikiUpdatedAfterSync) {
    reason = "Observed Qoder repo wiki updated since the last manual sync.";
  } else if (syncOlderThanWeek) {
    reason = "Manual Qoder wiki sync evidence is older than seven days.";
  }
  if (syncStale && !reminderDue) {
    reason = wikiUpdatedAfterSync
      ? "Observed Qoder repo wiki updated since the last manual sync, but gxpm has reminded within the last seven days."
      : "Manual Qoder wiki sync is stale, but gxpm has reminded within the last seven days.";
  }

  return { syncStale, reminderDue, reason, lastSyncAt, lastReminderAt, observedWikiUpdatedAt };
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

function readQoderWikiRecord(root: string): QoderWikiRecord | null {
  const path = join(root, QODER_STATE_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as QoderWikiRecord;
  } catch {
    return null;
  }
}

function writeQoderWikiRecord(root: string, patch: Partial<QoderWikiRecord>) {
  const path = join(root, QODER_STATE_PATH);
  const current = readQoderWikiRecord(root);
  const next: QoderWikiRecord = {
    ...(current ?? {}),
    ...definedOnly(patch),
    schemaVersion: 1,
    provider: "qoder",
    repoWikiRoot: QODER_REPOWIKI_ROOT,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function writeNativeWiki(input: {
  root?: string;
  now?: Date;
  mode: NativeWikiBuildResult["mode"];
}): NativeWikiBuildResult {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();
  const index = buildNativeWikiIndex({ root, now });
  const graph = buildNativeWikiGraph(index);
  const state: NativeWikiState = {
    schemaVersion: 1,
    provider: "gxpm",
    status: "idle",
    baseCommit: currentGitCommit(root),
    generatedAt: now.toISOString(),
    indexPath: NATIVE_WIKI_INDEX_PATH,
    graphPath: NATIVE_WIKI_GRAPH_PATH,
    contentRoot: NATIVE_WIKI_CONTENT_ROOT,
    queuedCommit: null,
  };
  mkdirSync(join(root, NATIVE_WIKI_ROOT, "index"), { recursive: true });
  mkdirSync(join(root, NATIVE_WIKI_CONTENT_ROOT), { recursive: true });
  writeJson(join(root, NATIVE_WIKI_INDEX_PATH), index);
  writeJson(join(root, NATIVE_WIKI_GRAPH_PATH), graph);
  writeJson(join(root, NATIVE_WIKI_STATE_PATH), state);
  const docs = writeNativeWikiDocs(root, state, index, graph);
  return { provider: "gxpm", mode: input.mode, state, index, graph, docs };
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

function summarizeNativeFile(root: string, file: string): NativeWikiFileEntry {
  const content = safeRead(file);
  const stat = statSync(file);
  const repoPath = toRepoPath(root, file);
  return {
    path: repoPath,
    language: languageForPath(repoPath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    lineCount: countLines(content),
    exports: extractExports(content),
    imports: extractImports(content),
    headings: extractMarkdownHeadings(content),
  };
}

function writeNativeWikiDocs(
  root: string,
  state: NativeWikiState,
  index: NativeWikiIndex,
  graph: NativeWikiGraph,
) {
  const docs = [
    ["Overview.md", renderNativeOverview(state, index, graph)],
    ["File-Index.md", renderNativeFileIndex(index)],
    ["Code-Graph.md", renderNativeCodeGraph(graph)],
    ...NATIVE_WIKI_TOPICS.map((topic) => [topic.fileName, renderNativeTopicDoc(topic, index, graph)] as const),
  ] as const;
  const paths: string[] = [];
  for (const [name, content] of docs) {
    const path = join(root, NATIVE_WIKI_CONTENT_ROOT, name);
    writeFileSync(path, content);
    paths.push(toRepoPath(root, path));
  }
  return paths;
}

function renderNativeOverview(state: NativeWikiState, index: NativeWikiIndex, graph: NativeWikiGraph) {
  const languages = countBy(index.files, (file) => file.language)
    .map(([language, count]) => `- ${language}: ${count}`)
    .join("\n");
  const highSignalFiles = index.files
    .filter((file) => file.exports.length > 0 || file.headings.length > 0)
    .slice(0, 20)
    .map((file) => `- [${file.path}](file://${file.path})`)
    .join("\n");
  return [
    "# GXPM Wiki Overview",
    "",
    `Generated: ${state.generatedAt}`,
    `Base commit: ${state.baseCommit ?? "unknown"}`,
    `Indexed files: ${index.files.length}`,
    `Import edges: ${graph.edges.length}`,
    "",
    "## Languages",
    "",
    languages || "- none",
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
    .map((file) => `| [${file.path}](file://${file.path}) | ${file.language} | ${file.exports.join(", ")} |`);
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
    .map((edge) => `- [${edge.from}](file://${edge.from}) -> [${edge.to}](file://${edge.to})`);
  return ["# Code Graph", "", ...edges, ""].join("\n");
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
    summary: "How gxpm initializes, updates, queries, and compares its first-party wiki with optional Qoder output.",
    keywords: ["wiki", "native", "qoder", "repowiki", "index", "query", "context", "knowledge"],
    sourcePaths: [
      "core/wiki.ts",
      "core/qoder.ts",
      "test/wiki.test.ts",
      "test/qoder-link.test.ts",
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
    .map((edge) => `- [${edge.from}](file://${edge.from}) -> [${edge.to}](file://${edge.to})`);

  return [
    `# ${topic.title}`,
    "",
    topic.summary,
    "",
    "<cite>",
    ...(citeLines.length > 0 ? citeLines : ["- No matching indexed source files."]),
    "</cite>",
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
  return `file://${file.path}#L1-L${endLine}`;
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
  return JSON.parse(readFileSync(path, "utf8")) as NativeWikiIndex;
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
    return JSON.parse(readFileSync(path, "utf8")) as NativeWikiIndex;
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
  const topicDocs = NATIVE_WIKI_TOPICS.map((topic, index) => ({
    path: `${NATIVE_WIKI_CONTENT_ROOT}/${topic.fileName}`,
    score: scoreNativeTopicSuggestion(topic, contextFiles, tokens),
    index,
  }))
    .filter((topic) => topic.score > 0 && allDocs.has(topic.path))
    .sort((a, b) => b.score - a.score || a.index - b.index || a.path.localeCompare(b.path))
    .map((topic) => topic.path);

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
  return dedupeBy([...topicDocs, ...genericDocs.sort(), ...overview], (path) => path);
}

function nativeFileMatches(file: NativeWikiFileEntry, tokens: string[]) {
  const matches: Array<{ label: string; score: number }> = [];
  const path = file.path.toLowerCase();
  const exports = file.exports.join(" ").toLowerCase();
  const imports = file.imports.join(" ").toLowerCase();
  const headings = file.headings.join(" ").toLowerCase();
  for (const token of tokens) {
    if (path.includes(token)) matches.push({ label: `path:${token}`, score: 5 });
    if (exports.includes(token)) matches.push({ label: `export:${token}`, score: 4 });
    if (headings.includes(token)) matches.push({ label: `heading:${token}`, score: 3 });
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
    .split(/[^a-z0-9_/-]+/)
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

function collectRegex(content: string, regex: RegExp, values: Set<string>, fallback?: string) {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const value = match[1]?.trim() || fallback;
    if (value) values.add(value);
  }
}

function resolveNativeImport(from: string, specifier: string, filePaths: Set<string>) {
  if (!specifier.startsWith(".")) return null;
  const base = normalizeRepoPath(join(dirname(from), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    `${base}.md`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
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

function newestKnownWikiTimestamp(root: string) {
  const repoWikiRoot = join(root, QODER_REPOWIKI_ROOT);
  const metadataFiles: string[] = [];
  walkFiles(repoWikiRoot, (file) => {
    if (file.endsWith(`${sep}repowiki-metadata.json`)) metadataFiles.push(file);
  });
  const timestamps: number[] = [];
  for (const file of metadataFiles) {
    try {
      timestamps.push(statSync(file).mtime.getTime());
    } catch {
      // Metadata files are only freshness hints; skip them if they drift mid-scan.
    }
  }
  const newest = timestamps.sort((a, b) => b - a)[0];
  return newest !== undefined ? new Date(newest).toISOString() : undefined;
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
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return false;
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) return false;
  }
  return true;
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
