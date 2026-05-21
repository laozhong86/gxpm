/**
 * Artifact Validator — structure checker for gxpm issue artifacts.
 *
 * This validates the current `.gxpm/issues/<id>/artifacts/*.json`
 * contract. It intentionally uses a small required-field surface so older
 * hand-authored artifacts remain readable while new writes still expose drift.
 */

import { ARTIFACT_TYPES, type ArtifactType } from "./artifacts";
import { evidenceIsWikiOnly } from "./evidence-guard";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** GXPM-166: non-blocking warnings (e.g. wiki-only evidence in verify-findings). */
  warnings?: string[];
}

// GXPM-166: artifact types whose evidence/findings should not be wiki-only.
const EVIDENCE_GUARDED_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  "verify-findings",
  "qa-findings",
  "pr-check",
]);

interface ArtifactSchema {
  requiredFields: string[];
}

const ARTIFACT_SCHEMAS: Record<ArtifactType, ArtifactSchema> = {
  "issue-intake": {
    requiredFields: [],
  },
  "triage-report": {
    requiredFields: [],
  },
  "autopilot-grant": {
    requiredFields: ["profile", "status", "allowedActions", "hardStops"],
  },
  "acceptance-contract": {
    requiredFields: ["criteria"],
  },
  "implementation-plan": {
    requiredFields: ["objective", "approach", "validation"],
  },
  "dispatch-handoff": {
    requiredFields: ["status", "inputArtifacts", "workerTasks"],
  },
  "behavior-spec": {
    requiredFields: ["feature", "scenarios"],
  },
  "wiki-context": {
    requiredFields: [],
  },
  "local-verify": {
    requiredFields: ["status", "commands", "results"],
  },
  "acceptance-check": {
    requiredFields: ["status", "criteria", "findings"],
  },
  "self-review": {
    requiredFields: ["status", "reviewedArtifacts", "findings"],
  },
  "ship-readiness": {
    requiredFields: ["status", "checklist", "rollbackPlan"],
  },
  "pr-check": {
    requiredFields: ["status", "pullRequest", "reviewFindings"],
  },
  "verify-findings": {
    requiredFields: ["status", "findings", "risks"],
  },
  "qa-findings": {
    requiredFields: ["status", "browserEvidence", "findings"],
  },
  "land-findings": {
    requiredFields: ["status", "landReady", "mergePlan"],
  },
  "cleanup-report": {
    requiredFields: [
      "status",
      "duplicatesExtracted",
      "renamesUnified",
      "interfacesAligned",
      "deadCodeRemoved",
      "testsDeduplicated",
    ],
  },
  "review-report": {
    requiredFields: ["status", "findings"],
  },
  "ship-audit-report": {
    requiredFields: ["status", "findings"],
  },
  "feedback-description": {
    requiredFields: [],
  },
  // GXPM-188: phase-handoff dump for the next-phase agent. Required fields
  // mirror the spec contract — completedAcceptance / nextPhaseMustRead /
  // openBlockers are always present (possibly empty arrays).
  "phase-handoff": {
    requiredFields: ["completedAcceptance", "nextPhaseMustRead", "openBlockers"],
  },
};

// GXPM-149: guard that ARTIFACT_SCHEMAS stays in sync with ARTIFACT_TYPES.
// Without this, a new type in artifacts.ts but missing in this map would cause
// validateArtifact to throw TypeError instead of a clear validation error.
for (const type of ARTIFACT_TYPES) {
  if (!(type in ARTIFACT_SCHEMAS)) {
    throw new Error(
      `[artifact-validator] ARTIFACT_SCHEMAS is missing entry for '${type}'. ` +
        `Every ArtifactType must have a registered schema (use { requiredFields: [] } for unrestricted types).`,
    );
  }
}

export function listValidatedArtifactTypes(): ArtifactType[] {
  return [...ARTIFACT_TYPES];
}

/**
 * Validate an artifact payload against its type schema.
 */
export function validateArtifact(type: string, payload: Record<string, unknown>): ValidationResult {
  if (!isArtifactType(type)) {
    return { valid: false, errors: [{ field: "type", message: `Invalid artifact type: ${type}` }] };
  }

  const schema = ARTIFACT_SCHEMAS[type];
  if (!schema) {
    return {
      valid: false,
      errors: [{ field: "type", message: `No schema registered for artifact type: ${type}` }],
    };
  }
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  for (const field of schema.requiredFields) {
    if (!(field in payload) || payload[field] === undefined || payload[field] === null) {
      errors.push({ field, message: `Missing required field: ${field}` });
    }
  }

  // GXPM-166: warn (do not fail) when verify/qa/pr-check evidence is wiki-only.
  // We inspect both common fields ('evidence', 'findings', 'browserEvidence',
  // 'reviewFindings') and the payload as a whole as a last resort.
  if (EVIDENCE_GUARDED_TYPES.has(type as ArtifactType)) {
    const candidate =
      payload.evidence ?? payload.findings ?? payload.browserEvidence ?? payload.reviewFindings ?? payload;
    if (evidenceIsWikiOnly(candidate)) {
      warnings.push(
        `evidence_wiki_only: ${type} evidence appears to be wiki-only. Add git diff, GitNexus impact, test logs, or browser screenshots to make verification reviewable.`,
      );
    }
  }

  const result: ValidationResult = { valid: errors.length === 0, errors };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

/**
 * Validate a raw artifact object (with schemaVersion, issueId, type, payload).
 */
export function validateRawArtifact(raw: Record<string, unknown>): ValidationResult {
  const type = raw.type as string;
  if (!type) {
    return { valid: false, errors: [{ field: "type", message: "Missing artifact type" }] };
  }

  if (!isArtifactType(type)) {
    return { valid: false, errors: [{ field: "type", message: `Unsupported artifact type for validation: ${type}` }] };
  }

  const payload = raw.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: [{ field: "payload", message: "Missing or invalid payload" }] };
  }

  return validateArtifact(type, payload as Record<string, unknown>);
}

function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPES.includes(value as ArtifactType);
}

/**
 * Format validation result for CLI output.
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];
  if (result.valid) {
    lines.push("✅ Artifact validation passed");
  } else {
    lines.push("❌ Artifact validation failed:");
    for (const err of result.errors) {
      lines.push(`  - ${err.field}: ${err.message}`);
    }
  }
  // GXPM-166: surface non-blocking warnings.
  for (const warning of result.warnings ?? []) {
    lines.push(`⚠️  Warning: ${warning}`);
  }
  return lines.join("\n");
}
