import { hasArtifact, readArtifact } from "./artifacts";
import { readIssueState } from "./state";

export interface LandCompletionAssessment {
  complete: boolean;
  missing: string[];
  evidence: {
    pullRequest: string | null;
    mergedSha: string | null;
    mergedAt: string | null;
    mainlineRef: string | null;
    mainlineContainsSha: boolean | null;
  };
}

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAINLINE_REF_CANDIDATES = ["origin/develop", "origin/main", "develop", "main", "HEAD"];

export function assessLandCompletion(input: { root?: string; issueId: string }): LandCompletionAssessment {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  const missing: string[] = [];

  if (state.currentPhase !== "land") {
    missing.push("land phase");
  }

  const landPayload = readArtifactPayload(root, input.issueId, "land-findings");
  if (!landPayload) {
    missing.push("land-findings artifact");
  }

  const pullRequest =
    normalizePullRequestEvidence(landPayload?.pullRequest) ??
    normalizePullRequestEvidence(landPayload?.pullRequestUrl) ??
    normalizePullRequestEvidence(readArtifactPayload(root, input.issueId, "pr-check")?.pullRequest);
  if (!pullRequest) {
    missing.push("pull request evidence");
  }

  const mergedSha = typeof landPayload?.mergedSha === "string" ? landPayload.mergedSha : null;
  const mergedAt = typeof landPayload?.mergedAt === "string" ? landPayload.mergedAt : null;
  const hasMergeEvidence = landPayload?.status === "landed" && mergedSha !== null && mergedAt !== null;
  if (!hasMergeEvidence) {
    missing.push("merge evidence");
  }

  let mainlineRef: string | null = null;
  let mainlineContainsSha: boolean | null = null;
  if (mergedSha && GIT_SHA_PATTERN.test(mergedSha)) {
    mainlineRef = resolveMainlineRef(root);
    mainlineContainsSha = mainlineRef ? gitContainsCommit(root, mainlineRef, mergedSha) : false;
  }
  if (mainlineContainsSha !== true) {
    missing.push("mainline contains evidence");
  }

  return {
    complete: missing.length === 0,
    missing,
    evidence: {
      pullRequest,
      mergedSha,
      mergedAt,
      mainlineRef,
      mainlineContainsSha,
    },
  };
}

export function assertLandCompletion(input: { root?: string; issueId: string; action: string }): LandCompletionAssessment {
  const assessment = assessLandCompletion(input);
  if (!assessment.complete) {
    throw new Error(`${input.action} requires completed land evidence: missing ${assessment.missing.join(", ")}`);
  }
  return assessment;
}

export function resolveMainlineRef(root: string): string | null {
  for (const ref of MAINLINE_REF_CANDIDATES) {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      return ref;
    }
  }
  return null;
}

export function gitContainsCommit(root: string, ref: string, sha: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["git", "merge-base", "--is-ancestor", sha, ref],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

function readArtifactPayload(root: string, issueId: string, type: string): Record<string, unknown> | null {
  if (!hasArtifact({ root, issueId, type })) {
    return null;
  }
  const artifact = readArtifact({ root, issueId, type });
  if (!artifact.payload || typeof artifact.payload !== "object" || Array.isArray(artifact.payload)) {
    return {};
  }
  return artifact.payload as Record<string, unknown>;
}

function normalizePullRequestEvidence(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "html_url", "webUrl", "href"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  if (typeof record.number === "number") {
    return `#${record.number}`;
  }
  return null;
}
