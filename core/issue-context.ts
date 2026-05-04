import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getIssuePaths, readIssueState, type IssueState } from "./state";
import { listArtifacts } from "./artifacts";
import type { ResumePacket } from "./checkpoint";

export type ResumeConfidence = "fresh" | "stale_resume" | "missing_resume" | "invalid_resume";

export interface IssueContextResult {
  schemaVersion: 1;
  issueId: string;
  currentPhase: string;
  title?: string;
  confidence: ResumeConfidence;
  confidenceReasons: string[];
  resumePhase?: string;
  resumeWrittenAt?: string;
  checkpointPath?: string;
  checkpointExists: boolean;
  requiredReads: string[];
  agentInstructions: string[];
  next: string;
}

interface BuildContextInput {
  root?: string;
  issueId: string;
}

export function buildIssueContext(input: BuildContextInput): IssueContextResult {
  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });

  const resumeResult = readResumeWithGrace(paths.issueDir);
  const artifacts = listArtifactsWithGrace({ root, issueId: input.issueId });
  const lastEventTimestamp = getLastEventTimestamp(paths.issueDir);

  const confidence = computeConfidence({
    state,
    issueDir: paths.issueDir,
    resume: resumeResult.packet,
    resumeError: resumeResult.error,
    lastEventTimestamp,
  });

  const confidenceReasons = buildConfidenceReasons({
    state,
    resume: resumeResult.packet,
    resumeError: resumeResult.error,
    lastEventTimestamp,
    checkpointExists: resumeResult.checkpointExists,
  });

  const requiredReads = buildRequiredReads({ state, artifacts, resume: resumeResult.packet });
  const agentInstructions = buildAgentInstructions({ state, confidence, resume: resumeResult.packet });
  const next = buildNextGuidance(state);

  return {
    schemaVersion: 1,
    issueId: state.issueId,
    currentPhase: state.currentPhase,
    title: resumeResult.packet?.title ?? undefined,
    confidence,
    confidenceReasons,
    resumePhase: resumeResult.packet?.phase ?? undefined,
    resumeWrittenAt: resumeResult.packet?.writtenAt ?? undefined,
    checkpointPath: resumeResult.packet?.checkpointPath ?? undefined,
    checkpointExists: resumeResult.checkpointExists,
    requiredReads,
    agentInstructions,
    next,
  };
}

interface ResumeReadResult {
  packet: ResumePacket | null;
  error: string | null;
  checkpointExists: boolean;
}

function readResumeWithGrace(issueDir: string): ResumeReadResult {
  const latestIndexPath = join(issueDir, "memory", "latest-resume-packet.json");
  let resumePath: string | null = null;
  let raw: unknown = null;
  let parseError: string | null = null;

  if (existsSync(latestIndexPath)) {
    try {
      const index = JSON.parse(readFileSync(latestIndexPath, "utf8")) as { path?: string };
      if (index.path) {
        const candidate = join(issueDir, index.path);
        if (existsSync(candidate)) {
          resumePath = candidate;
          raw = JSON.parse(readFileSync(candidate, "utf8"));
        }
      }
    } catch {
      parseError = "latest resume packet index is not valid JSON";
    }
  }

  if (!resumePath) {
    const oldPath = join(issueDir, "memory", "resume-packet.json");
    if (existsSync(oldPath)) {
      resumePath = oldPath;
      try {
        raw = JSON.parse(readFileSync(oldPath, "utf8"));
      } catch {
        parseError = "resume packet is not valid JSON";
      }
    }
  }

  if (!resumePath) {
    return { packet: null, error: null, checkpointExists: false };
  }

  if (parseError) {
    return { packet: null, error: parseError, checkpointExists: false };
  }

  if (!raw || typeof raw !== "object") {
    return { packet: null, error: "resume packet is not an object", checkpointExists: false };
  }

  const record = raw as Record<string, unknown>;
  const phase = typeof record.phase === "string" ? record.phase : "";
  const writtenAt = typeof record.writtenAt === "string" ? record.writtenAt : "";
  const checkpointPath = typeof record.checkpointPath === "string" ? record.checkpointPath : "";
  const title = typeof record.title === "string" ? record.title : "";

  if (!phase || !writtenAt) {
    return { packet: null, error: "resume packet missing required fields (phase, writtenAt)", checkpointExists: false };
  }

  const checkpointExists = checkpointPath ? existsSync(join(issueDir, checkpointPath)) : false;

  const packet: ResumePacket = {
    schemaVersion: 1,
    issueId: String(record.issueId ?? ""),
    phase,
    title,
    status: typeof record.status === "string" ? record.status : "in-progress",
    branch: typeof record.branch === "string" ? record.branch : "unknown",
    writtenAt,
    checkpointPath,
    summary: typeof record.summary === "string" ? record.summary : "",
    decisions: normalizeStringArray(record.decisions),
    remainingWork: normalizeStringArray(record.remainingWork),
    notes: normalizeStringArray(record.notes),
    filesModified: normalizeStringArray(record.filesModified),
    ...(typeof record.sessionDurationSeconds === "number" && Number.isFinite(record.sessionDurationSeconds)
      ? { sessionDurationSeconds: record.sessionDurationSeconds }
      : {}),
    ...(typeof record.parentCheckpointId === "string" && record.parentCheckpointId.trim()
      ? { parentCheckpointId: record.parentCheckpointId }
      : {}),
    ...(typeof record.transitionReason === "string" && record.transitionReason.trim()
      ? { transitionReason: record.transitionReason }
      : {}),
  };

  return { packet, error: null, checkpointExists };
}

function listArtifactsWithGrace(input: { root: string; issueId: string }): string[] {
  try {
    return listArtifacts(input).map((a) => a.type);
  } catch {
    return [];
  }
}

function getLastEventTimestamp(issueDir: string): string | null {
  const eventsPath = join(issueDir, "events.jsonl");
  if (!existsSync(eventsPath)) return null;

  const content = readFileSync(eventsPath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  try {
    const lastEvent = JSON.parse(lines[lines.length - 1]) as { timestamp?: string };
    return lastEvent.timestamp ?? null;
  } catch {
    return null;
  }
}

interface ConfidenceInput {
  state: IssueState;
  issueDir: string;
  resume: ResumePacket | null;
  resumeError: string | null;
  lastEventTimestamp: string | null;
}

function computeConfidence(input: ConfidenceInput): ResumeConfidence {
  const { state, issueDir, resume, resumeError } = input;

  if (resumeError) {
    return "invalid_resume";
  }

  if (!resume) {
    return "missing_resume";
  }

  if (resume.phase !== state.currentPhase) {
    return "stale_resume";
  }

  if (!resume.checkpointPath || !existsSync(join(issueDir, resume.checkpointPath))) {
    return "invalid_resume";
  }

  const resumeTime = new Date(resume.writtenAt).getTime();
  if (Number.isNaN(resumeTime)) {
    return "invalid_resume";
  }

  const stateUpdatedTime = new Date(state.updatedAt).getTime();
  if (stateUpdatedTime > resumeTime) {
    return "stale_resume";
  }

  if (input.lastEventTimestamp) {
    const eventTime = new Date(input.lastEventTimestamp).getTime();
    if (eventTime > resumeTime) {
      return "stale_resume";
    }
  }

  return "fresh";
}

function buildConfidenceReasons(input: {
  state: IssueState;
  resume: ResumePacket | null;
  resumeError: string | null;
  lastEventTimestamp: string | null;
  checkpointExists: boolean;
}): string[] {
  const reasons: string[] = [];

  if (input.resumeError) {
    reasons.push(input.resumeError);
    return reasons;
  }

  if (!input.resume) {
    reasons.push("no resume packet found");
    return reasons;
  }

  if (input.resume.phase !== input.state.currentPhase) {
    reasons.push(`resume phase (${input.resume.phase}) differs from current phase (${input.state.currentPhase})`);
  }

  if (!input.checkpointExists) {
    reasons.push(`checkpoint path does not exist: ${input.resume.checkpointPath ?? "none"}`);
  }

  const resumeTime = new Date(input.resume.writtenAt).getTime();
  const stateUpdatedTime = new Date(input.state.updatedAt).getTime();
  if (stateUpdatedTime > resumeTime) {
    reasons.push(`state updatedAt (${input.state.updatedAt}) is newer than resume writtenAt (${input.resume.writtenAt})`);
  }

  if (input.lastEventTimestamp) {
    const eventTime = new Date(input.lastEventTimestamp).getTime();
    if (eventTime > resumeTime) {
      reasons.push(`latest event timestamp (${input.lastEventTimestamp}) is newer than resume writtenAt (${input.resume.writtenAt})`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("resume packet is consistent with current state and events");
  }

  return reasons;
}

function buildRequiredReads(input: {
  state: IssueState;
  artifacts: string[];
  resume: ResumePacket | null;
}): string[] {
  const reads: string[] = [];
  reads.push(`.gxpm/issues/${input.state.issueId}/state.json`);
  reads.push(`.gxpm/issues/${input.state.issueId}/events.jsonl`);

  const currentPhaseArtifact = getCurrentPhaseArtifact(input.state.currentPhase);
  if (currentPhaseArtifact && input.artifacts.includes(currentPhaseArtifact)) {
    reads.push(`.gxpm/issues/${input.state.issueId}/artifacts/${currentPhaseArtifact}.json`);
  }

  if (input.resume?.checkpointPath) {
    reads.push(`.gxpm/issues/${input.state.issueId}/${input.resume.checkpointPath}`);
  }

  return reads;
}

function buildAgentInstructions(input: {
  state: IssueState;
  confidence: ResumeConfidence;
  resume: ResumePacket | null;
}): string[] {
  const instructions: string[] = [];

  switch (input.confidence) {
    case "fresh":
      instructions.push("Resume context is fresh. You may use the resume packet and checkpoint as supplementary context, but state.json and events.jsonl remain the highest-priority truth sources.");
      if (input.resume?.remainingWork && input.resume.remainingWork.length > 0) {
        instructions.push(`Remaining work from checkpoint: ${input.resume.remainingWork.join("; ")}`);
      }
      break;
    case "stale_resume":
      instructions.push("Resume context is stale. Rebuild your understanding from state.json, events.jsonl, and current phase artifacts. Do not rely on the resume packet for remaining work.");
      break;
    case "missing_resume":
      instructions.push("No resume packet found. Build context entirely from state.json, events.jsonl, and current phase artifacts.");
      break;
    case "invalid_resume":
      instructions.push("Resume packet is invalid or unreadable. Ignore it and build context from state.json, events.jsonl, and current phase artifacts.");
      break;
  }

  instructions.push(`Current phase is ${input.state.currentPhase}. Run gxpm issue next ${input.state.issueId} if you are unsure what to do next.`);
  return instructions;
}

function buildNextGuidance(state: IssueState): string {
  const phaseOrder = [
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

  const idx = phaseOrder.indexOf(state.currentPhase as (typeof phaseOrder)[number]);
  if (idx < 0) return `Unknown phase: ${state.currentPhase}`;
  if (idx >= phaseOrder.length - 1) return "Terminal phase reached.";

  const nextPhase = phaseOrder[idx + 1];
  return `Next phase: ${nextPhase}. Run gxpm issue transition ${state.issueId} ${nextPhase} when ready.`;
}

function getCurrentPhaseArtifact(phase: string): string | null {
  const map: Record<string, string> = {
    triage: "acceptance-contract",
    plan: "implementation-plan",
    dispatch: "dispatch-handoff",
    implement: "local-verify",
    "local-verify": "acceptance-check",
    "ac-check": "self-review",
    "self-review": "ship-readiness",
    ship: "pr-check",
    "pr-check": "verify-findings",
    verify: "qa-findings",
    qa: "land-findings",
    land: "land-findings",
  };
  return map[phase] ?? null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
