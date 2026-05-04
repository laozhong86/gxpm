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
  transitionReason?: string;
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
  parentCheckpointId?: string;
  transitionReason?: string;
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
  const resumePacketsDir = join(paths.issueDir, "memory", "resume-packets");
  mkdirSync(resumePacketsDir, { recursive: true });

  const parentCheckpointId = readPreviousResumePacketPath(paths.issueDir);

  const basePacket: Omit<ResumePacket, "checkpointPath" | "parentCheckpointId"> = {
    schemaVersion: 1,
    issueId: input.issueId,
    phase: state.currentPhase,
    title,
    status: payload.status ?? "in-progress",
    branch,
    writtenAt,
    summary: payload.summary,
    decisions: payload.decisions ?? [],
    remainingWork: payload.remainingWork ?? [],
    notes: payload.notes ?? [],
    filesModified: payload.filesModified ?? [],
    ...(payload.sessionDurationSeconds === undefined
      ? {}
      : { sessionDurationSeconds: payload.sessionDurationSeconds }),
    ...(payload.transitionReason === undefined
      ? {}
      : { transitionReason: payload.transitionReason }),
  };

  const relativeCheckpointPath = writeUniqueCheckpointMarkdown({
    issueDir: paths.issueDir,
    timestamp: formatTimestamp(now),
    titleSlug: slugTitle(title),
    renderMarkdown: (checkpointPath) =>
      renderCheckpointMarkdown({ ...basePacket, checkpointPath }),
  });

  const resumePacket: ResumePacket = {
    ...basePacket,
    checkpointPath: relativeCheckpointPath,
    ...(parentCheckpointId ? { parentCheckpointId } : {}),
  };

  const relativeResumePacketPath = writeUniqueResumePacket({
    issueDir: paths.issueDir,
    timestamp: formatTimestamp(now),
    titleSlug: slugTitle(title),
    packet: resumePacket,
  });

  writeFileSync(
    join(paths.issueDir, "memory", "latest-resume-packet.json"),
    `${JSON.stringify({ schemaVersion: 1, path: relativeResumePacketPath }, null, 2)}\n`,
  );

  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "checkpoint.written",
      issueId: input.issueId,
      timestamp: writtenAt,
      payload: {
        checkpointPath: relativeCheckpointPath,
        resumePacketPath: relativeResumePacketPath,
        ...(parentCheckpointId ? { parentCheckpointId } : {}),
        ...(payload.transitionReason ? { transitionReason: payload.transitionReason } : {}),
      },
    },
  });

  return {
    schemaVersion: 1,
    issueId: input.issueId,
    path: relativeCheckpointPath,
    resumePacketPath: relativeResumePacketPath,
    writtenAt,
  };
}

export function readResumePacket(input: { root?: string; issueId: string }): ResumePacket {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  readIssueState({ root, issueId: input.issueId });

  const latestIndexPath = join(paths.issueDir, "memory", "latest-resume-packet.json");
  if (existsSync(latestIndexPath)) {
    const index = JSON.parse(readFileSync(latestIndexPath, "utf8")) as { path?: string };
    if (index.path) {
      const packetPath = join(paths.issueDir, index.path);
      if (existsSync(packetPath)) {
        return JSON.parse(readFileSync(packetPath, "utf8")) as ResumePacket;
      }
    }
  }

  // Backward compatibility: old single-file resume packet
  const oldPath = join(paths.issueDir, "memory", "resume-packet.json");
  if (existsSync(oldPath)) {
    return JSON.parse(readFileSync(oldPath, "utf8")) as ResumePacket;
  }

  throw new Error(
    `No resume packet found for ${input.issueId}; run gxpm issue checkpoint ${input.issueId} --title "handoff" --stdin`,
  );
}

function readPreviousResumePacketPath(issueDir: string): string | null {
  const latestIndexPath = join(issueDir, "memory", "latest-resume-packet.json");
  if (existsSync(latestIndexPath)) {
    const index = JSON.parse(readFileSync(latestIndexPath, "utf8")) as { path?: string };
    if (index.path) {
      const fullPath = join(issueDir, index.path);
      if (existsSync(fullPath)) {
        return index.path;
      }
    }
  }

  // Backward compatibility: old single-file resume packet
  const oldPath = join(issueDir, "memory", "resume-packet.json");
  if (existsSync(oldPath)) {
    return "memory/resume-packet.json";
  }

  return null;
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
    transitionReason:
      typeof raw.transitionReason === "string" && raw.transitionReason.trim()
        ? raw.transitionReason.trim()
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

function writeUniqueCheckpointMarkdown(input: {
  issueDir: string;
  timestamp: string;
  titleSlug: string;
  renderMarkdown: (relativePath: string) => string;
}) {
  const base = `memory/checkpoints/${input.timestamp}-${input.titleSlug}`;
  let suffix = 1;

  while (true) {
    const relativePath = suffix === 1 ? `${base}.md` : `${base}-${suffix}.md`;
    try {
      writeFileSync(join(input.issueDir, relativePath), input.renderMarkdown(relativePath), {
        flag: "wx",
      });
      return relativePath;
    } catch (error) {
      if (isFileExistsError(error)) {
        suffix += 1;
        continue;
      }
      throw error;
    }
  }
}

function writeUniqueResumePacket(input: {
  issueDir: string;
  timestamp: string;
  titleSlug: string;
  packet: ResumePacket;
}) {
  const base = `memory/resume-packets/${input.timestamp}-${input.titleSlug}`;
  let suffix = 1;

  while (true) {
    const relativePath = suffix === 1 ? `${base}.json` : `${base}-${suffix}.json`;
    try {
      writeFileSync(join(input.issueDir, relativePath), `${JSON.stringify(input.packet, null, 2)}\n`, {
        flag: "wx",
      });
      return relativePath;
    } catch (error) {
      if (isFileExistsError(error)) {
        suffix += 1;
        continue;
      }
      throw error;
    }
  }
}

function renderCheckpointMarkdown(packet: ResumePacket) {
  return `---
schemaVersion: 1
issueId: ${yamlScalar(packet.issueId)}
status: ${yamlScalar(packet.status)}
phase: ${yamlScalar(packet.phase)}
branch: ${yamlScalar(packet.branch)}
timestamp: ${yamlScalar(packet.writtenAt)}
checkpointPath: ${yamlScalar(packet.checkpointPath)}
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
  return `files_modified:\n${filesModified.map((path) => `  - ${yamlScalar(path)}`).join("\n")}`;
}

function yamlScalar(value: string) {
  return JSON.stringify(value);
}

function isFileExistsError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
