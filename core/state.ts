import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getGateCommand, getRequiredArtifactForTransition } from "./phase-gates";
import { resolveAgentIdentity, resolveSessionId } from "./session";
import { getWorkflowEventEmitter } from "./workflow-event-emitter";
import { getResolvedConfigValue } from "./config";

export const CURRENT_SCHEMA_VERSION = 1;

// Issues whose phaseHistory shows implement entered before this cutoff are
// exempt from the specify-gate (introduced on this date). Do NOT change
// retroactively — that would break legacy issues.
export const SPECIFY_PHASE_CUTOFF = "2026-05-14T00:00:00Z";

export const GXPM_PHASES = [
  "triage",
  "plan",
  "dispatch",
  "specify",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "verify",
  "qa",
  "land",
] as const;

export type GxpmPhase = (typeof GXPM_PHASES)[number];

export const ISSUE_TYPES = ["feature", "meta", "spike"] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export const RIGOR_LEVELS = ["lite", "standard", "full"] as const;

export type RigorLevel = (typeof RIGOR_LEVELS)[number];

export interface IssueOwnershipHistoryEntry {
  sessionId: string;
  firstTouch: string;
  lastTouch: string;
}

export interface IssueOwnership {
  currentSession: string;
  lastTouchedAt: string;
  history: IssueOwnershipHistoryEntry[];
}

export interface IssueCreator {
  host: string;
  sessionId: string;
  actor: string;
  createdAt: string;
}

interface BaseIssueClaim {
  actor: string;
  claimedBySession: string;
  claimedAt: string;
  runId?: string;
}

export interface ClaimedIssueClaim extends BaseIssueClaim {
  status: "claimed";
}

export interface ReleasedIssueClaim extends BaseIssueClaim {
  status: "released";
  releasedAt: string;
  releasedBySession: string;
  releaseReason: string;
}

export interface StaleIssueClaim extends BaseIssueClaim {
  status: "stale";
  staleAt: string;
  staleReason: string;
}

export type IssueClaim = ClaimedIssueClaim | ReleasedIssueClaim | StaleIssueClaim;

export interface IssueState {
  schemaVersion: 1;
  issueId: string;
  issueType?: IssueType;
  rigorLevel?: RigorLevel;
  currentPhase: GxpmPhase;
  createdAt: string;
  updatedAt: string;
  stateRoot: string;
  artifactRoot: string;
  creator?: IssueCreator;
  ownership?: IssueOwnership;
  claim?: IssueClaim;
  archived?: boolean;
  archivedAt?: string | null;
  phaseHistory: Array<{
    phase: GxpmPhase;
    enteredAt: string;
    fromPhase: GxpmPhase | null;
  }>;
}

export interface StateEvent {
  schemaVersion: 1;
  type:
    | "issue.created"
    | "phase.transitioned"
    | "artifact.written"
    | "artifact.reconciled"
    | "checkpoint.written"
    | "gate.blocked"
    | "gate.passed"
    | "issue.claimed"
    | "issue.claim.released"
    | "issue.claim.stale"
    | "cleanup.executed"
    | "gate.brainstorm.skipped"
    | "ownership.changed";
  issueId: string;
  timestamp: string;
  sessionId?: string;
  payload: Record<string, unknown>;
}

type RawIssueState = Partial<IssueState> & {
  schemaVersion?: number;
  issueId?: unknown;
  issueType?: unknown;
  currentPhase?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  stateRoot?: unknown;
  artifactRoot?: unknown;
  claim?: unknown;
  archived?: unknown;
  archivedAt?: unknown;
  phaseHistory?: unknown;
};

interface IssueInput {
  root?: string;
  issueId: string;
  issueType?: IssueType;
}

interface TransitionInput extends IssueInput {
  nextPhase: GxpmPhase | string;
}

const ISSUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function getIssuePaths(root = process.cwd(), issueId: string) {
  assertValidIssueId(issueId);
  const issueRoot = join(".gxpm", "issues", issueId);
  const issueDir = join(root, issueRoot);
  const artifactRoot = join(issueRoot, "artifacts");

  return {
    issueRoot,
    issueDir,
    artifactRoot,
    statePath: join(issueDir, "state.json"),
    graphPath: join(issueDir, "graph.json"),
    artifactIndexPath: join(issueDir, "artifacts", "index.json"),
    eventsPath: join(issueDir, "events.jsonl"),
  };
}

export function createIssueState(input: IssueInput): IssueState {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);

  if (existsSync(paths.statePath)) {
    throw new Error(`Issue state already exists: ${input.issueId}`);
  }

  mkdirSync(join(paths.issueDir, "artifacts"), { recursive: true });
  mkdirSync(join(paths.issueDir, "reports"), { recursive: true });
  mkdirSync(join(paths.issueDir, "evidence", "screenshots"), { recursive: true });
  mkdirSync(join(paths.issueDir, "memory"), { recursive: true });

  const now = new Date().toISOString();
  const sessionId = resolveSessionId();
  const agent = resolveAgentIdentity(process.env, root);
  const defaultRigor = (input.issueType === "spike" || input.issueType === "meta") ? "lite" : "standard";
  const state: IssueState = {
    schemaVersion: 1,
    issueId: input.issueId,
    issueType: input.issueType ?? "feature",
    rigorLevel: defaultRigor,
    currentPhase: "triage",
    createdAt: now,
    updatedAt: now,
    stateRoot: paths.issueRoot,
    artifactRoot: paths.artifactRoot,
    creator: {
      host: agent.host,
      sessionId: agent.sessionId,
      actor: agent.actor,
      createdAt: now,
    },
    ownership: {
      currentSession: sessionId,
      lastTouchedAt: now,
      history: [{ sessionId, firstTouch: now, lastTouch: now }],
    },
    phaseHistory: [{ phase: "triage", enteredAt: now, fromPhase: null }],
  };

  writeJson(paths.statePath, state);
  writeJson(paths.graphPath, {
    schemaVersion: 1,
    issueId: input.issueId,
    phases: GXPM_PHASES,
    currentPhase: "triage",
    transitions: [{ fromPhase: null, toPhase: "triage", timestamp: now }],
  });
  writeJson(paths.artifactIndexPath, {
    schemaVersion: 1,
    issueId: input.issueId,
    artifacts: [],
  });
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "issue.created",
      issueId: input.issueId,
      timestamp: now,
      sessionId,
      payload: { initialPhase: "triage", issueType: state.issueType },
    },
  });

  getWorkflowEventEmitter().emit({
    type: "issue_created",
    issueId: input.issueId,
    issueType: state.issueType,
    timestamp: now,
  });

  fireAndForgetSync(root, input.issueId, "created", { issueType: state.issueType });

  return state;
}

export function readIssueState(input: IssueInput): IssueState {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);

  if (!existsSync(paths.statePath)) {
    throw new Error(`Issue state not found: ${input.issueId}`);
  }

  const raw = JSON.parse(readFileSync(paths.statePath, "utf8")) as RawIssueState;
  return migrateIssueState(raw);
}

export function transitionIssuePhase(input: TransitionInput): IssueState {
  const nextPhase = assertValidPhase(input.nextPhase);
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });
  const allowedNextPhase = getNextPhase(state.currentPhase);

  if (nextPhase !== allowedNextPhase) {
    throw new Error(
      `Invalid phase transition: ${state.currentPhase} -> ${nextPhase}; allowed next phase: ${
        allowedNextPhase ?? "<none>"
      }`,
    );
  }

  assertPhaseGate({
    issueId: input.issueId,
    fromPhase: state.currentPhase,
    nextPhase,
    issueDir: paths.issueDir,
  });

  const now = new Date().toISOString();
  const sessionId = resolveSessionId();
  const updated: IssueState = touchIssueOwnership({
    state: {
      ...state,
      currentPhase: nextPhase,
      updatedAt: now,
      phaseHistory: [
        ...state.phaseHistory,
        { phase: nextPhase, enteredAt: now, fromPhase: state.currentPhase },
      ],
    },
    sessionId,
  });

  writeJson(paths.statePath, updated);
  const graph = JSON.parse(readFileSync(paths.graphPath, "utf8"));
  writeJson(paths.graphPath, {
    ...graph,
    currentPhase: nextPhase,
    transitions: [
      ...(Array.isArray(graph.transitions) ? graph.transitions : []),
      { fromPhase: state.currentPhase, toPhase: nextPhase, timestamp: now },
    ],
  });
  const ownershipEvent = buildOwnershipChangedEvent({
    issueId: input.issueId,
    timestamp: now,
    previousState: state,
    nextState: updated,
    sessionId,
  });
  if (ownershipEvent) {
    appendIssueEvent({ issueDir: paths.issueDir, event: ownershipEvent });
  }
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "phase.transitioned",
      issueId: input.issueId,
      timestamp: now,
      sessionId,
      payload: { fromPhase: state.currentPhase, toPhase: nextPhase },
    },
  });

  getWorkflowEventEmitter().emit({
    type: "issue_transitioned",
    issueId: input.issueId,
    fromPhase: state.currentPhase,
    toPhase: nextPhase,
    timestamp: now,
  });

  fireAndForgetSync(root, input.issueId, "transitioned", { fromPhase: state.currentPhase, toPhase: nextPhase });

  return updated;
}

export function appendIssueEvent(input: { issueDir: string; event: StateEvent }) {
  appendFileSync(join(input.issueDir, "events.jsonl"), `${JSON.stringify(input.event)}\n`);
}

export function setIssueArchived(input: IssueInput & { archived: boolean }): IssueState {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });

  const now = new Date().toISOString();
  const updated: IssueState = {
    ...state,
    archived: input.archived,
    archivedAt: input.archived ? now : null,
    updatedAt: now,
  };
  writeJson(paths.statePath, updated);

  fireAndForgetSync(root, input.issueId, "archived", { archived: input.archived });

  return updated;
}

export function getNextPhase(phase: GxpmPhase) {
  const index = GXPM_PHASES.indexOf(phase);
  return GXPM_PHASES[index + 1] ?? null;
}

export function isGxpmPhase(value: string): value is GxpmPhase {
  return GXPM_PHASES.includes(value as GxpmPhase);
}

export function isIssueType(value: string): value is IssueType {
  return ISSUE_TYPES.includes(value as IssueType);
}

export function normalizeIssueType(value: unknown): IssueType {
  return typeof value === "string" && isIssueType(value) ? value : "feature";
}

export function isRigorLevel(value: string): value is RigorLevel {
  return RIGOR_LEVELS.includes(value as RigorLevel);
}

export function normalizeRigorLevel(value: unknown): RigorLevel | undefined {
  return typeof value === "string" && isRigorLevel(value) ? value : undefined;
}

function migrateIssueState(raw: RawIssueState): IssueState {
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported issue state schemaVersion: ${String(raw.schemaVersion)}`);
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    issueId: String(raw.issueId),
    issueType: normalizeIssueType(raw.issueType),
    rigorLevel: normalizeRigorLevel(raw.rigorLevel),
    currentPhase: assertValidPhase(String(raw.currentPhase)),
    createdAt: String(raw.createdAt),
    updatedAt: String(raw.updatedAt),
    stateRoot: String(raw.stateRoot),
    artifactRoot: String(raw.artifactRoot),
    creator: normalizeCreator(raw.creator),
    claim: normalizeClaim(raw.claim),
    archived: typeof raw.archived === "boolean" ? raw.archived : undefined,
    archivedAt:
      typeof raw.archivedAt === "string" || raw.archivedAt === null ? raw.archivedAt : undefined,
    ownership: normalizeOwnership(raw.ownership),
    phaseHistory: Array.isArray(raw.phaseHistory)
      ? raw.phaseHistory.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            phase: assertValidPhase(String(record.phase)),
            enteredAt: String(record.enteredAt),
            fromPhase:
              record.fromPhase === null ? null : assertValidPhase(String(record.fromPhase)),
          };
        })
      : [],
  };
}

function assertValidIssueId(issueId: string) {
  if (!ISSUE_ID_PATTERN.test(issueId)) {
    throw new Error(`Invalid issue id: ${issueId}`);
  }
}

function assertValidPhase(value: string): GxpmPhase {
  if (!isGxpmPhase(value)) {
    throw new Error(`Invalid phase: ${value}`);
  }
  return value;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fireAndForgetSync(
  root: string,
  issueId: string,
  action: string,
  meta: Record<string, unknown>,
) {
  import("./issue-sync")
    .then(({ maybeSyncIssue }) => maybeSyncIssue({ root, issueId, action, meta }))
    .catch(() => {
      // Silently fail — local state is truth
    });
}

export function touchIssueOwnership(input: { state: IssueState; sessionId: string }): IssueState {
  const ownership = normalizeOwnership(input.state.ownership);
  const touchedAt = input.state.updatedAt;
  if (!ownership) {
    return {
      ...input.state,
      ownership: {
        currentSession: input.sessionId,
        lastTouchedAt: touchedAt,
        history: [{ sessionId: input.sessionId, firstTouch: touchedAt, lastTouch: touchedAt }],
      },
    };
  }

  const existingEntry = ownership.history.find((entry) => entry.sessionId === input.sessionId);
  const nextHistory = existingEntry
    ? ownership.history.map((entry) =>
        entry.sessionId === input.sessionId ? { ...entry, lastTouch: touchedAt } : entry,
      )
    : [...ownership.history, { sessionId: input.sessionId, firstTouch: touchedAt, lastTouch: touchedAt }];

  return {
    ...input.state,
    ownership: {
      currentSession: input.sessionId,
      lastTouchedAt: touchedAt,
      history: nextHistory,
    },
  };
}

export function buildOwnershipChangedEvent(input: {
  issueId: string;
  timestamp: string;
  previousState: IssueState;
  nextState: IssueState;
  sessionId: string;
}): StateEvent | null {
  const before = normalizeOwnership(input.previousState.ownership);
  const after = normalizeOwnership(input.nextState.ownership);
  if (!before || !after || before.currentSession === after.currentSession) {
    return null;
  }
  return {
    schemaVersion: 1,
    type: "ownership.changed",
    issueId: input.issueId,
    timestamp: input.timestamp,
    sessionId: input.sessionId,
    payload: {
      fromSession: before.currentSession,
      toSession: after.currentSession,
      changedAt: input.timestamp,
    },
  };
}

function normalizeOwnership(value: unknown): IssueOwnership | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const currentSession = typeof record.currentSession === "string" ? record.currentSession : "";
  if (!currentSession.trim()) {
    return undefined;
  }

  const history = normalizeOwnershipHistory(record.history);
  const lastTouchedAt =
    typeof record.lastTouchedAt === "string"
      ? record.lastTouchedAt
      : history.find((entry) => entry.sessionId === currentSession)?.lastTouch;

  const ensuredHistory = ensureCurrentSessionHistory(history, currentSession, lastTouchedAt);
  const fallbackLastTouch =
    ensuredHistory.find((entry) => entry.sessionId === currentSession)?.lastTouch ??
    new Date(0).toISOString();

  return {
    currentSession,
    lastTouchedAt: lastTouchedAt ?? fallbackLastTouch,
    history: ensuredHistory,
  };
}

function normalizeCreator(value: unknown): IssueCreator | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const host = typeof record.host === "string" && record.host.trim() ? record.host : "";
  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.trim() ? record.sessionId : "";
  const actor = typeof record.actor === "string" && record.actor.trim() ? record.actor : "";
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : "";
  if (!host || !sessionId || !actor || !createdAt) {
    return undefined;
  }
  return { host, sessionId, actor, createdAt };
}

function normalizeClaim(value: unknown): IssueClaim | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.status !== "claimed" && record.status !== "released" && record.status !== "stale") {
    return undefined;
  }
  const actor = typeof record.actor === "string" && record.actor.trim() ? record.actor : "";
  const claimedBySession =
    typeof record.claimedBySession === "string" && record.claimedBySession.trim()
      ? record.claimedBySession
      : "";
  const claimedAt =
    typeof record.claimedAt === "string" && record.claimedAt.trim() ? record.claimedAt : "";
  if (!actor || !claimedBySession || !claimedAt) {
    return undefined;
  }
  const runId = typeof record.runId === "string" && record.runId.trim() ? record.runId : undefined;
  const base = { actor, claimedBySession, claimedAt, runId };
  if (record.status === "claimed") {
    return { status: "claimed", ...base };
  }
  if (record.status === "released") {
    const releasedAt =
      typeof record.releasedAt === "string" && record.releasedAt.trim() ? record.releasedAt : "";
    const releasedBySession =
      typeof record.releasedBySession === "string" && record.releasedBySession.trim()
        ? record.releasedBySession
        : "";
    const releaseReason =
      typeof record.releaseReason === "string" && record.releaseReason.trim()
        ? record.releaseReason
        : "";
    if (!releasedAt || !releasedBySession || !releaseReason) {
      return undefined;
    }
    return { status: "released", ...base, releasedAt, releasedBySession, releaseReason };
  }

  const staleAt = typeof record.staleAt === "string" && record.staleAt.trim() ? record.staleAt : "";
  const staleReason =
    typeof record.staleReason === "string" && record.staleReason.trim() ? record.staleReason : "";
  if (!staleAt || !staleReason) {
    return undefined;
  }
  return { status: "stale", ...base, staleAt, staleReason };
}

function normalizeOwnershipHistory(value: unknown): IssueOwnershipHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return value.map((sessionId) => ({
      sessionId,
      firstTouch: new Date(0).toISOString(),
      lastTouch: new Date(0).toISOString(),
    }));
  }
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const sessionId = typeof item.sessionId === "string" ? item.sessionId : "";
      const firstTouch = typeof item.firstTouch === "string" ? item.firstTouch : "";
      const lastTouch = typeof item.lastTouch === "string" ? item.lastTouch : firstTouch;
      return { sessionId, firstTouch, lastTouch };
    })
    .filter((entry) => entry.sessionId.trim().length > 0 && entry.firstTouch && entry.lastTouch);
}

function ensureCurrentSessionHistory(
  history: IssueOwnershipHistoryEntry[],
  currentSession: string,
  lastTouchedAt?: string,
): IssueOwnershipHistoryEntry[] {
  const existing = history.find((entry) => entry.sessionId === currentSession);
  if (existing) {
    if (lastTouchedAt && existing.lastTouch !== lastTouchedAt) {
      return history.map((entry) =>
        entry.sessionId === currentSession ? { ...entry, lastTouch: lastTouchedAt } : entry,
      );
    }
    return history;
  }
  const touch = lastTouchedAt ?? new Date(0).toISOString();
  return [...history, { sessionId: currentSession, firstTouch: touch, lastTouch: touch }];
}

function assertWorktreeGate(input: {
  issueId: string;
  fromPhase: GxpmPhase;
  nextPhase: GxpmPhase;
  issueDir: string;
}) {
  if (input.fromPhase !== "dispatch" || input.nextPhase !== "implement") {
    return;
  }
  const branch = getCurrentGitBranch();
  const baseBranch = getResolvedConfigValue({ key: "worktree.baseBranch" }).value as string;
  if (!branch || branch === baseBranch) {
    return;
  }
  const canonicalRoot = getCanonicalMainRoot();
  const currentRoot = getCurrentGitRoot();
  if (!canonicalRoot || !currentRoot || normalizePath(currentRoot) !== normalizePath(canonicalRoot)) {
    return;
  }

  const now = new Date().toISOString();
  appendIssueEvent({
    issueDir: input.issueDir,
    event: {
      schemaVersion: 1,
      type: "gate.blocked",
      issueId: input.issueId,
      timestamp: now,
      sessionId: resolveSessionId(),
      payload: {
        fromPhase: input.fromPhase,
        toPhase: input.nextPhase,
        reason: `dispatch-to-implement blocked: canonical main checkout must stay on ${baseBranch}; create a git worktree for feature branches`,
      },
    },
  });
  throw new Error(
    `Transition blocked: dispatch -> implement requires a dedicated git worktree when on a feature branch. ` +
    `Current directory is the canonical main checkout on branch '${branch}'. ` +
    `Run: gxpm workspace ensure ${input.issueId}`,
  );
}

function assertArtifactGate(input: {
  issueId: string;
  fromPhase: GxpmPhase;
  nextPhase: GxpmPhase;
  issueDir: string;
}) {
  const requiredArtifact = getRequiredArtifactForTransition(input.fromPhase, input.nextPhase);
  if (!requiredArtifact) {
    return;
  }

  // Derive root from issueDir (<root>/.gxpm/issues/<id>) so readIssueState
  // uses the same temp dir in tests rather than process.cwd().
  const derivedRoot = resolve(input.issueDir, "..", "..", "..");

  const requiredArtifactPath = join(input.issueDir, "artifacts", `${requiredArtifact}.json`);
  if (existsSync(requiredArtifactPath)) {
    // Task 4: specify->implement gate — verify confirmedAt is set.
    if (requiredArtifact === "behavior-spec" && input.nextPhase === "implement") {
      const state = readIssueState({ root: derivedRoot, issueId: input.issueId });
      const legacyEntry = state.phaseHistory?.find((h) => h.phase === "implement");
      const isLegacy =
        legacyEntry !== undefined && legacyEntry.enteredAt < SPECIFY_PHASE_CUTOFF;
      if (!isLegacy) {
        const raw = JSON.parse(readFileSync(requiredArtifactPath, "utf8"));
        const confirmedAt = raw?.payload?.confirmedAt;
        if (!confirmedAt) {
          const now = new Date().toISOString();
          appendIssueEvent({
            issueDir: input.issueDir,
            event: {
              schemaVersion: 1,
              type: "gate.blocked",
              issueId: input.issueId,
              timestamp: now,
              sessionId: resolveSessionId(),
              payload: {
                fromPhase: input.fromPhase,
                toPhase: input.nextPhase,
                missingArtifact: "behavior-spec.confirmedAt",
              },
            },
          });
          throw new Error(
            `behavior-spec exists but confirmedAt is null; run \`gxpm specify confirm ${input.issueId}\` to confirm`,
          );
        }
      }
    }

    const now = new Date().toISOString();
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "gate.passed",
        issueId: input.issueId,
        timestamp: now,
        sessionId: resolveSessionId(),
        payload: {
          fromPhase: input.fromPhase,
          toPhase: input.nextPhase,
          requiredArtifact,
        },
      },
    });
    return;
  }

  const now = new Date().toISOString();
  appendIssueEvent({
    issueDir: input.issueDir,
    event: {
      schemaVersion: 1,
      type: "gate.blocked",
      issueId: input.issueId,
      timestamp: now,
      sessionId: resolveSessionId(),
      payload: {
        fromPhase: input.fromPhase,
        toPhase: input.nextPhase,
        missingArtifact: requiredArtifact,
      },
    },
  });

  // Task 4.5: legacy bypass — if this issue previously entered implement
  // before the specify-gate cutoff, skip the gate entirely. We still emit
  // the gate.blocked event above so the attempt is recorded, but we return
  // rather than throwing so in-flight legacy issues are not blocked.
  if (requiredArtifact === "behavior-spec") {
    const state = readIssueState({ root: derivedRoot, issueId: input.issueId });
    const legacyEntry = state.phaseHistory?.find((h) => h.phase === "implement");
    if (legacyEntry && legacyEntry.enteredAt < SPECIFY_PHASE_CUTOFF) {
      return; // legacy bypass
    }
  }

  throw new Error(
    `Missing required artifact: ${requiredArtifact}; run ${getGateCommand(input.issueId, requiredArtifact)}`,
  );
}

function assertPhaseGate(input: {
  issueId: string;
  fromPhase: GxpmPhase;
  nextPhase: GxpmPhase;
  issueDir: string;
}) {
  assertWorktreeGate(input);
  assertArtifactGate(input);
}

function getCurrentGitBranch(): string | undefined {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    const branch = result.stdout.toString().trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

function getCanonicalMainRoot(): string | undefined {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", "worktree", "list", "--porcelain"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    const line = result.stdout
      .toString()
      .split("\n")
      .find((l) => l.startsWith("worktree "));
    return line?.slice("worktree ".length);
  } catch {
    return undefined;
  }
}

function getCurrentGitRoot(): string | undefined {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--show-toplevel"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizePath(path: string): string {
  const resolved = resolve(path).replace(/\/+$/, "");
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
