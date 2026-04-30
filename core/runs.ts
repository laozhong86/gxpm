import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getIssuePaths, readIssueState } from "./state";
import { resolveSessionId } from "./session";

export const RUN_STATUSES = [
  "preparing-workspace",
  "building-prompt",
  "launching-agent",
  "streaming-turn",
  "succeeded",
  "failed",
  "timed-out",
  "stalled",
  "canceled-by-reconciliation",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = [
  "succeeded",
  "failed",
  "timed-out",
  "stalled",
  "canceled-by-reconciliation",
] as const satisfies readonly RunStatus[];

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export interface RunEvent {
  schemaVersion: 1;
  type: string;
  timestamp: string;
  status: RunStatus;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface RunRecord {
  schemaVersion: 1;
  issueId: string;
  runId: string;
  attempt: number;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
  workspacePath?: string;
  failureReason?: string;
  events: RunEvent[];
}

export interface StartRunInput {
  root?: string;
  issueId: string;
  attempt?: number;
  status?: RunStatus | string;
  workspacePath?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface AppendRunEventInput {
  root?: string;
  issueId: string;
  runId: string;
  type: string;
  status?: RunStatus | string;
  message?: string;
  failureReason?: string;
  payload?: Record<string, unknown>;
}

export interface RunRefInput {
  root?: string;
  issueId: string;
  runId: string;
}

export function startRun(input: StartRunInput): RunRecord {
  const root = input.root ?? process.cwd();
  readIssueState({ root, issueId: input.issueId });
  const now = new Date().toISOString();
  const status = assertRunStatus(input.status ?? "preparing-workspace");
  const run: RunRecord = {
    schemaVersion: 1,
    issueId: input.issueId,
    runId: createRunId(now),
    attempt: normalizeAttempt(input.attempt),
    status,
    createdAt: now,
    updatedAt: now,
    sessionId: resolveSessionId(),
    workspacePath: input.workspacePath,
    events: [
      {
        schemaVersion: 1,
        type: "run.started",
        timestamp: now,
        status,
        message: input.message,
        payload: input.payload,
      },
    ],
  };

  mkdirSync(runsDir(root, input.issueId), { recursive: true });
  writeRunRecord(root, run);
  return run;
}

export function appendRunEvent(input: AppendRunEventInput): RunRecord {
  const root = input.root ?? process.cwd();
  const run = readRun({ root, issueId: input.issueId, runId: input.runId });
  const now = new Date().toISOString();
  const status = assertRunStatus(input.status ?? run.status);
  const updated: RunRecord = {
    ...run,
    status,
    updatedAt: now,
    failureReason: input.failureReason ?? run.failureReason,
    events: [
      ...run.events,
      {
        schemaVersion: 1,
        type: input.type,
        timestamp: now,
        status,
        message: input.message,
        payload: input.payload,
      },
    ],
  };

  writeRunRecord(root, updated);
  return updated;
}

export function readRun(input: RunRefInput): RunRecord {
  const root = input.root ?? process.cwd();
  const file = runPath(root, input.issueId, input.runId);
  if (!existsSync(file)) {
    throw new Error(`Run not found: ${input.runId}`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as RunRecord;
}

export function listRuns(input: { root?: string; issueId: string }): RunRecord[] {
  const root = input.root ?? process.cwd();
  readIssueState({ root, issueId: input.issueId });
  const dir = runsDir(root, input.issueId);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as RunRecord)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return TERMINAL_RUN_STATUSES.includes(status as TerminalRunStatus);
}

function writeRunRecord(root: string, run: RunRecord) {
  writeFileSync(runPath(root, run.issueId, run.runId), `${JSON.stringify(run, null, 2)}\n`);
}

function runsDir(root: string, issueId: string) {
  return join(getIssuePaths(root, issueId).issueDir, "runs");
}

function runPath(root: string, issueId: string, runId: string) {
  return join(runsDir(root, issueId), `${assertRunId(runId)}.json`);
}

function createRunId(timestamp: string) {
  const compact = timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run-${compact}-${randomUUID().slice(0, 8)}`;
}

function assertRunId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Invalid run id: ${value}`);
  }
  return value;
}

function assertRunStatus(value: string): RunStatus {
  if (!RUN_STATUSES.includes(value as RunStatus)) {
    throw new Error(`Invalid run status: ${value}`);
  }
  return value as RunStatus;
}

function normalizeAttempt(value: number | undefined) {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("run attempt must be a positive integer");
  }
  return value;
}
