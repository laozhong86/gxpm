import { hasArtifact, readArtifact, rewriteArtifact } from "./artifacts";
import { createPhaseArtifactInitializer } from "./phase-artifact";
import { readIssueState, type StateEvent } from "./state";

export interface LandFindingsPayload {
  landReady?: boolean;
  mergePlan?: string;
  qaFindingsArtifact?: string;
  releaseRisks?: unknown[];
  status?: string;
  summary?: string;
  mergedAt?: string;
  mergedSha?: string;
  [key: string]: unknown;
}

export interface LandFindingsReconcileResult {
  reconciled: boolean;
  reason: string;
  mergedAt?: string;
}

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export const initializeLandFindings = createPhaseArtifactInitializer({
  artifactType: "land-findings",
  label: "Land findings",
  payload: {
    landReady: false,
    mergePlan: "",
    qaFindingsArtifact: "qa-findings",
    releaseRisks: [],
    status: "draft",
    summary: "",
  },
  requiredPhase: "qa",
});

export function reconcileLandFindings(input: {
  root?: string;
  issueId: string;
  sha: string;
}): LandFindingsReconcileResult {
  if (!GIT_SHA_PATTERN.test(input.sha)) {
    throw new Error(`Invalid git sha: ${input.sha}`);
  }

  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  if (state.currentPhase !== "land") {
    return { reconciled: false, reason: `phase=${state.currentPhase} is not land` };
  }

  if (!hasArtifact({ root, issueId: input.issueId, type: "land-findings" })) {
    return { reconciled: false, reason: "land-findings artifact missing" };
  }

  const artifact = readArtifact({ root, issueId: input.issueId, type: "land-findings" });
  const currentPayload = asPayloadRecord(artifact.payload);
  if (
    currentPayload.status === "landed" &&
    currentPayload.mergedSha === input.sha &&
    typeof currentPayload.mergedAt === "string"
  ) {
    return { reconciled: false, reason: "land-findings already reconciled", mergedAt: currentPayload.mergedAt };
  }

  const mergedAt = new Date().toISOString();
  const payload: LandFindingsPayload = {
    ...currentPayload,
    status: "landed",
    mergedAt,
    mergedSha: input.sha,
  };
  const event: StateEvent = {
    schemaVersion: 1,
    type: "artifact.reconciled",
    issueId: input.issueId,
    timestamp: mergedAt,
    payload: {
      artifactType: "land-findings",
      path: "artifacts/land-findings.json",
      mergedAt,
      mergedSha: input.sha,
    },
  };

  rewriteArtifact({
    root,
    issueId: input.issueId,
    type: "land-findings",
    payload,
    timestamp: mergedAt,
    event,
  });

  return { reconciled: true, reason: "land-findings reconciled", mergedAt };
}

function asPayloadRecord(payload: unknown): LandFindingsPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as LandFindingsPayload;
}
