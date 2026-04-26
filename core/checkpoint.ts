import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  appendIssueEvent,
  getIssuePaths,
  readIssueState,
} from "./state";

export interface CheckpointPayload {
  status?: string;
  summary: string;
  decisions?: string[];
  remainingWork?: string[];
  notes?: string[];
  filesModified?: string[];
  sessionDurationSeconds?: number;
}

export interface ResumePacket {
  schemaVersion: 1;
  issueId: string;
  phase: string;
  title: string;
  status: string;
  branch: string;
  writtenAt: string;
  checkpointPath: string;
  summary: string;
  decisions: string[];
  remainingWork: string[];
  notes: string[];
  filesModified: string[];
  sessionDurationSeconds?: number;
}

interface CheckpointInput {
  root?: string;
  issueId: string;
  title?: string;
  branch?: string;
  now?: Date;
  payload: unknown;
}

export interface IssueCheckpointRecord {
  schemaVersion: 1;
  issueId: string;
  path: string;
  resumePacketPath: string;
  writtenAt: string;
}

export function writeIssueCheckpoint(input: CheckpointInput): IssueCheckpointRecord {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });
  const payload = normalizeCheckpointPayload(input.payload);
  const title = normalizeTitle(input.title ?? getPayloadTitle(input.payload) ?? "checkpoint");
  const now = input.now ?? new Date();
  const writtenAt = now.toISOString();
  const branch = input.branch?.trim() || "unknown";

  const checkpointDir = join(paths.issueDir, "memory", "checkpoints");
  mkdirSync(checkpointDir, { recursive: true });

  const relativeCheckpointPath = uniqueCheckpointPath({
    issueDir: paths.issueDir,
    timestamp: formatTimestamp(now),
    titleSlug: slugTitle(title),
  });
  const resumePacketPath = "memory/resume-packet.json";
  const checkpointPath = join(paths.issueDir, relativeCheckpointPath);

  const packet: ResumePacket = {
    schemaVersion: 1,
    issueId: input.issueId,
    phase: state.currentPhase,
    title,
    status: payload.status ?? "in-progress",
    branch,
    writtenAt,
    checkpointPath: relativeCheckpointPath,
    summary: payload.summary,
    decisions: payload.decisions ?? [],
    remainingWork: payload.remainingWork ?? [],
    notes: payload.notes ?? [],
    filesModified: payload.filesModified ?? [],
    ...(payload.sessionDurationSeconds === undefined
      ? {}
      : { sessionDurationSeconds: payload.sessionDurationSeconds }),
  };

  writeFileSync(checkpointPath, renderCheckpointMarkdown(packet));
  writeFileSync(join(paths.issueDir, resumePacketPath), `${JSON.stringify(packet, null, 2)}\n`);
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "checkpoint.written",
      issueId: input.issueId,
      timestamp: writtenAt,
      payload: { checkpointPath: relativeCheckpointPath, resumePacketPath },
    },
  });

  return {
    schemaVersion: 1,
    issueId: input.issueId,
    path: relativeCheckpointPath,
    resumePacketPath,
    writtenAt,
  };
}

export function readResumePacket(input: { root?: string; issueId: string }): ResumePacket {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  readIssueState({ root, issueId: input.issueId });
  const resumePacketPath = join(paths.issueDir, "memory", "resume-packet.json");

  if (!existsSync(resumePacketPath)) {
    throw new Error(
      `No resume packet found for ${input.issueId}; run gxpm issue checkpoint ${input.issueId} --title \"handoff\" --stdin`,
    );
  }

  return JSON.parse(readFileSync(resumePacketPath, "utf8")) as ResumePacket;
}

function normalizeCheckpointPayload(value: unknown): CheckpointPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Checkpoint payload must be a JSON object");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary !== "string" || raw.summary.trim() === "") {
    throw new Error("Checkpoint payload requires a non-empty string summary");
  }

  return {
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : undefined,
    summary: raw.summary.trim(),
    decisions: normalizeStringArray(raw.decisions),
    remainingWork: normalizeStringArray(raw.remainingWork),
    notes: normalizeStringArray(raw.notes),
    filesModified: normalizeStringArray(raw.filesModified),
    sessionDurationSeconds:
      typeof raw.sessionDurationSeconds === "number" && Number.isFinite(raw.sessionDurationSeconds)
        ? raw.sessionDurationSeconds
        : undefined,
  };
}

function getPayloadTitle(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const title = (value as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeTitle(title: string) {
  return title.trim() || "checkpoint";
}

function slugTitle(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 60);
  return slug || "checkpoint";
}

function formatTimestamp(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function uniqueCheckpointPath(input: { issueDir: string; timestamp: string; titleSlug: string }) {
  const base = `memory/checkpoints/${input.timestamp}-${input.titleSlug}`;
  let candidate = `${base}.md`;
  let suffix = 2;

  while (existsSync(join(input.issueDir, candidate))) {
    candidate = `${base}-${suffix}.md`;
    suffix += 1;
  }

  return candidate;
}

function renderCheckpointMarkdown(packet: ResumePacket) {
  return `---
schemaVersion: 1
issueId: ${packet.issueId}
status: ${packet.status}
phase: ${packet.phase}
branch: ${packet.branch}
timestamp: ${packet.writtenAt}
checkpointPath: ${packet.checkpointPath}
${renderFilesModifiedFrontmatter(packet.filesModified)}
---

## Working on: ${packet.title}

### Summary

${packet.summary}

### Decisions Made

${renderList(packet.decisions)}

### Remaining Work

${renderNumberedList(packet.remainingWork)}

### Notes

${renderList(packet.notes)}
`;
}

function renderList(items: string[]) {
  if (items.length === 0) return "- none";
  return items.map((item) => `- ${item}`).join("\n");
}

function renderNumberedList(items: string[]) {
  if (items.length === 0) return "1. none";
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function renderFilesModifiedFrontmatter(filesModified: string[]) {
  if (filesModified.length === 0) return "files_modified: []";
  return `files_modified:\n${filesModified.map((path) => `  - ${path}`).join("\n")}`;
}
