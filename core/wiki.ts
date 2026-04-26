import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const QODER_REPOWIKI_ROOT = ".qoder/repowiki";
const QODER_STATE_PATH = ".gxpm/wiki/qoder.json";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOP_PAGES = 8;

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

function toRepoPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}
