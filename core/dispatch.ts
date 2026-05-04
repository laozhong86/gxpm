import { readArtifact, writeArtifact } from "./artifacts";
import { readIssueState } from "./state";
import type { PhaseArtifactInput } from "./phase-artifact";

interface DispatchHandoffPayload {
  inputArtifacts: string[];
  status: "draft" | "finalized";
  stopRule: string;
  targetBranch: string;
  validation: string[];
  worktreePath: string;
  worktreeDecision: "pending" | "created" | "reused" | "existing";
  workerTasks: Array<{ id: string; description: string; status: "pending" | "in_progress" | "done" }>;
}

function generateTaskId(index: number): string {
  return `task-${String(index + 1).padStart(3, "0")}`;
}

function safeReadArtifactPayload(
  root: string | undefined,
  issueId: string,
  type: string,
): Record<string, unknown> | undefined {
  try {
    const artifact = readArtifact({ root, issueId, type });
    return (artifact.payload ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildStopRule(
  planPayload: Record<string, unknown> | undefined,
  triagePayload: Record<string, unknown> | undefined,
): string {
  const parts: string[] = [];

  const planRisks = planPayload?.risks;
  if (Array.isArray(planRisks)) {
    for (const item of planRisks) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
      }
    }
  }

  const triageNonGoals = triagePayload?.nonGoals;
  if (Array.isArray(triageNonGoals)) {
    for (const item of triageNonGoals) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
      }
    }
  }

  return parts.join("; ");
}

function buildWorkerTasks(
  planPayload: Record<string, unknown> | undefined,
): DispatchHandoffPayload["workerTasks"] {
  const steps = planPayload?.steps;
  if (!Array.isArray(steps)) {
    return [];
  }

  const tasks: DispatchHandoffPayload["workerTasks"] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (typeof step === "string" && step.trim()) {
      tasks.push({
        id: generateTaskId(i),
        description: step.trim(),
        status: "pending",
      });
    }
  }
  return tasks;
}

function buildValidation(
  planPayload: Record<string, unknown> | undefined,
): string[] {
  const raw = planPayload?.validation;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function initializeDispatch(input: PhaseArtifactInput) {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });

  if (state.currentPhase !== "dispatch") {
    throw new Error(
      `Dispatch can only be initialized from dispatch phase: current phase is ${state.currentPhase}`,
    );
  }

  const planPayload = safeReadArtifactPayload(root, input.issueId, "implementation-plan");
  const triagePayload = safeReadArtifactPayload(root, input.issueId, "triage-report");

  const payload: DispatchHandoffPayload = {
    inputArtifacts: ["acceptance-contract", "implementation-plan"],
    status: "draft",
    stopRule: buildStopRule(planPayload, triagePayload),
    targetBranch: "",
    validation: buildValidation(planPayload),
    worktreePath: "",
    worktreeDecision: "pending",
    workerTasks: buildWorkerTasks(planPayload),
  };

  return writeArtifact({
    root,
    issueId: input.issueId,
    type: "dispatch-handoff",
    payload,
  });
}
