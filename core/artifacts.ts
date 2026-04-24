import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendIssueEvent,
  getIssuePaths,
  readIssueState,
  type StateEvent,
} from "./state";

export const ARTIFACT_TYPES = [
  "issue-intake",
  "triage-report",
  "acceptance-contract",
  "implementation-plan",
  "dispatch-handoff",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface ArtifactRecord {
  schemaVersion: 1;
  type: ArtifactType;
  path: string;
  writtenAt: string;
}

export interface StoredArtifact {
  schemaVersion: 1;
  issueId: string;
  type: ArtifactType;
  writtenAt: string;
  payload: unknown;
}

interface ArtifactInput {
  root?: string;
  issueId: string;
}

interface WriteArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
  payload: unknown;
}

interface ReadArtifactInput extends ArtifactInput {
  type: ArtifactType | string;
}

export function writeArtifact(input: WriteArtifactInput): ArtifactRecord {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  readIssueState({ root, issueId: input.issueId });

  const now = new Date().toISOString();
  const relativePath = `artifacts/${type}.json`;
  const artifact: StoredArtifact = {
    schemaVersion: 1,
    issueId: input.issueId,
    type,
    writtenAt: now,
    payload: input.payload,
  };
  writeFileSync(join(paths.issueDir, relativePath), `${JSON.stringify(artifact, null, 2)}\n`);

  const record: ArtifactRecord = {
    schemaVersion: 1,
    type,
    path: relativePath,
    writtenAt: now,
  };
  writeArtifactIndex(
    paths.artifactIndexPath,
    input.issueId,
    upsertRecord(listArtifacts({ root, issueId: input.issueId }), record),
  );
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: artifactWrittenEvent(input.issueId, type, now, relativePath),
  });

  return record;
}

export function readArtifact(input: ReadArtifactInput): StoredArtifact {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  const artifactPath = join(paths.issueDir, "artifacts", `${type}.json`);

  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${type}`);
  }

  return JSON.parse(readFileSync(artifactPath, "utf8")) as StoredArtifact;
}

export function listArtifacts(input: ArtifactInput): ArtifactRecord[] {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);

  if (!existsSync(paths.artifactIndexPath)) {
    throw new Error(`Artifact index not found: ${input.issueId}`);
  }

  const index = JSON.parse(readFileSync(paths.artifactIndexPath, "utf8")) as {
    artifacts?: ArtifactRecord[];
  };
  return Array.isArray(index.artifacts) ? index.artifacts : [];
}

export function hasArtifact(input: ReadArtifactInput): boolean {
  const root = input.root ?? process.cwd();
  const type = assertValidArtifactType(input.type);
  const paths = getIssuePaths(root, input.issueId);
  return existsSync(join(paths.issueDir, "artifacts", `${type}.json`));
}

function writeArtifactIndex(path: string, issueId: string, artifacts: ArtifactRecord[]) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        issueId,
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
}

function upsertRecord(records: ArtifactRecord[], record: ArtifactRecord) {
  return [...records.filter((item) => item.type !== record.type), record].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}

function artifactWrittenEvent(
  issueId: string,
  artifactType: ArtifactType,
  timestamp: string,
  path: string,
): StateEvent {
  return {
    schemaVersion: 1,
    type: "artifact.written",
    issueId,
    timestamp,
    payload: { artifactType, path },
  };
}

function assertValidArtifactType(value: string): ArtifactType {
  if (!ARTIFACT_TYPES.includes(value as ArtifactType)) {
    throw new Error(`Invalid artifact type: ${value}`);
  }
  return value as ArtifactType;
}
