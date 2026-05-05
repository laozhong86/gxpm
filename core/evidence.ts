import { dirname, join, resolve, sep } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { getIssuePaths, readIssueState } from "./state";

export const EVIDENCE_KINDS = [
  "command-logs",
  "browser-snapshots",
  "browser-screenshots",
  "browser-console",
  "browser-errors",
  "screenshots",
  "investigations",
  "review",
  "release",
  "test-runs",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface IssueEvidencePath {
  schemaVersion: 1;
  issueId: string;
  kind: EvidenceKind;
  path: string;
  absolutePath: string;
}

export interface IssueEvidenceRecord extends IssueEvidencePath {
  writtenAt: string;
  mediaType: string;
}

interface EvidencePathInput {
  root?: string;
  issueId: string;
  kind: EvidenceKind | string;
  filename: string;
}

interface WriteEvidenceInput extends EvidencePathInput {
  mediaType?: string;
}

interface WriteJsonEvidenceInput extends WriteEvidenceInput {
  payload: unknown;
}

interface WriteTextEvidenceInput extends WriteEvidenceInput {
  text: string;
}

interface WriteBytesEvidenceInput extends WriteEvidenceInput {
  bytes: Uint8Array;
}

const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_EXTENSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function evidenceFilename(prefix: string, extension: string, timestamp = new Date()) {
  assertSafeFilenamePart(prefix, "evidence filename prefix");
  const normalizedExtension = extension.startsWith(".") ? extension.slice(1) : extension;
  if (!SAFE_EXTENSION_PATTERN.test(normalizedExtension)) {
    throw new Error(`Invalid evidence filename extension: ${extension}`);
  }
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${normalizedExtension}`;
}

export function prepareIssueEvidencePath(input: EvidencePathInput): IssueEvidencePath {
  const root = input.root ?? process.cwd();
  const kind = assertValidEvidenceKind(input.kind);
  assertSafeEvidenceFilename(input.filename);

  const paths = getIssuePaths(root, input.issueId);
  readIssueState({ root, issueId: input.issueId });

  const relativePath = toPosixPath(join("evidence", kind, input.filename));
  const absolutePath = join(paths.issueDir, relativePath);
  assertInsideIssueDir(paths.issueDir, absolutePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  return {
    schemaVersion: 1,
    issueId: input.issueId,
    kind,
    path: relativePath,
    absolutePath,
  };
}

export function writeIssueEvidenceJson(input: WriteJsonEvidenceInput): IssueEvidenceRecord {
  const path = prepareIssueEvidencePath(input);
  return writeIssueEvidence(path, `${JSON.stringify(input.payload, null, 2)}\n`, input.mediaType ?? "application/json");
}

export function writeIssueEvidenceText(input: WriteTextEvidenceInput): IssueEvidenceRecord {
  const path = prepareIssueEvidencePath(input);
  return writeIssueEvidence(path, input.text, input.mediaType ?? "text/plain");
}

export function writeIssueEvidenceBytes(input: WriteBytesEvidenceInput): IssueEvidenceRecord {
  const path = prepareIssueEvidencePath(input);
  return writeIssueEvidence(path, input.bytes, input.mediaType ?? "application/octet-stream");
}

function writeIssueEvidence(
  path: IssueEvidencePath,
  content: string | Uint8Array,
  mediaType: string,
): IssueEvidenceRecord {
  writeFileSync(path.absolutePath, content);
  return {
    ...path,
    writtenAt: new Date().toISOString(),
    mediaType,
  };
}

function assertValidEvidenceKind(value: string): EvidenceKind {
  if (!EVIDENCE_KINDS.includes(value as EvidenceKind)) {
    throw new Error(`Invalid evidence kind: ${value}`);
  }
  return value as EvidenceKind;
}

function assertSafeEvidenceFilename(filename: string) {
  if (!SAFE_FILENAME_PATTERN.test(filename)) {
    throw new Error(`Invalid evidence filename: ${filename}`);
  }
}

function assertSafeFilenamePart(value: string, label: string) {
  if (!SAFE_FILENAME_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertInsideIssueDir(issueDir: string, absolutePath: string) {
  const issueRoot = resolve(issueDir);
  const target = resolve(absolutePath);
  if (target !== issueRoot && !target.startsWith(`${issueRoot}${sep}`)) {
    throw new Error(`Evidence path escapes issue directory: ${absolutePath}`);
  }
}

function toPosixPath(path: string) {
  return path.split(sep).join("/");
}
