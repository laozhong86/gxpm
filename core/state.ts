import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const GXPM_PHASES = [
  "triage",
  "plan",
  "dispatch",
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

export interface IssueState {
  schemaVersion: 1;
  issueId: string;
  currentPhase: GxpmPhase;
  createdAt: string;
  updatedAt: string;
  stateRoot: string;
  artifactRoot: string;
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
    | "gate.blocked"
    | "gate.passed";
  issueId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface IssueInput {
  root?: string;
  issueId: string;
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
  const state: IssueState = {
    schemaVersion: 1,
    issueId: input.issueId,
    currentPhase: "triage",
    createdAt: now,
    updatedAt: now,
    stateRoot: paths.issueRoot,
    artifactRoot: paths.artifactRoot,
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
      payload: { initialPhase: "triage" },
    },
  });

  return state;
}

export function readIssueState(input: IssueInput): IssueState {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);

  if (!existsSync(paths.statePath)) {
    throw new Error(`Issue state not found: ${input.issueId}`);
  }

  return JSON.parse(readFileSync(paths.statePath, "utf8")) as IssueState;
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
  const updated: IssueState = {
    ...state,
    currentPhase: nextPhase,
    updatedAt: now,
    phaseHistory: [
      ...state.phaseHistory,
      { phase: nextPhase, enteredAt: now, fromPhase: state.currentPhase },
    ],
  };

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
  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "phase.transitioned",
      issueId: input.issueId,
      timestamp: now,
      payload: { fromPhase: state.currentPhase, toPhase: nextPhase },
    },
  });

  return updated;
}

export function appendIssueEvent(input: { issueDir: string; event: StateEvent }) {
  appendFileSync(join(input.issueDir, "events.jsonl"), `${JSON.stringify(input.event)}\n`);
}

export function getNextPhase(phase: GxpmPhase) {
  const index = GXPM_PHASES.indexOf(phase);
  return GXPM_PHASES[index + 1] ?? null;
}

export function isGxpmPhase(value: string): value is GxpmPhase {
  return GXPM_PHASES.includes(value as GxpmPhase);
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

function assertPhaseGate(input: {
  issueId: string;
  fromPhase: GxpmPhase;
  nextPhase: GxpmPhase;
  issueDir: string;
}) {
  const requiredArtifact = getRequiredArtifactForTransition(input.fromPhase, input.nextPhase);
  if (!requiredArtifact) {
    return;
  }

  const requiredArtifactPath = join(input.issueDir, "artifacts", `${requiredArtifact}.json`);
  if (existsSync(requiredArtifactPath)) {
    const now = new Date().toISOString();
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "gate.passed",
        issueId: input.issueId,
        timestamp: now,
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
      payload: {
        fromPhase: input.fromPhase,
        toPhase: input.nextPhase,
        missingArtifact: requiredArtifact,
      },
    },
  });
  throw new Error(
    `Missing required artifact: ${requiredArtifact}; run ${getGateCommand(input.issueId, requiredArtifact)}`,
  );
}

function getRequiredArtifactForTransition(fromPhase: GxpmPhase, nextPhase: GxpmPhase) {
  if (fromPhase === "triage" && nextPhase === "plan") {
    return "acceptance-contract";
  }
  if (fromPhase === "plan" && nextPhase === "dispatch") {
    return "implementation-plan";
  }
  if (fromPhase === "dispatch" && nextPhase === "implement") {
    return "dispatch-handoff";
  }
  if (fromPhase === "implement" && nextPhase === "local-verify") {
    return "local-verify";
  }
  if (fromPhase === "local-verify" && nextPhase === "ac-check") {
    return "acceptance-check";
  }
  if (fromPhase === "ac-check" && nextPhase === "self-review") {
    return "self-review";
  }
  if (fromPhase === "self-review" && nextPhase === "ship") {
    return "ship-readiness";
  }
  if (fromPhase === "ship" && nextPhase === "pr-check") {
    return "pr-check";
  }
  return null;
}

function getGateCommand(issueId: string, artifactType: string) {
  if (artifactType === "pr-check") {
    return `gxpm ship pr-check ${issueId}`;
  }
  if (artifactType === "ship-readiness") {
    return `gxpm self-review ship ${issueId}`;
  }
  if (artifactType === "self-review") {
    return `gxpm ac-check self-review ${issueId}`;
  }
  if (artifactType === "acceptance-check") {
    return `gxpm local-verify ac-check ${issueId}`;
  }
  if (artifactType === "local-verify") {
    return `gxpm implement verify ${issueId}`;
  }
  if (artifactType === "dispatch-handoff") {
    return `gxpm dispatch init ${issueId}`;
  }
  if (artifactType === "implementation-plan") {
    return `gxpm plan init ${issueId}`;
  }
  return `gxpm triage init ${issueId}`;
}
