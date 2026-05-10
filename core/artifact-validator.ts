/**
 * Artifact Validator — structure checker for gxpm issue artifacts.
 *
 * This validates the current `.gxpm/issues/<id>/artifacts/*.json`
 * contract. It intentionally uses a small required-field surface so older
 * hand-authored artifacts remain readable while new writes still expose drift.
 */

import { ARTIFACT_TYPES, type ArtifactType } from "./artifacts";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

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
  "acceptance-contract": {
    requiredFields: ["criteria"],
  },
  "implementation-plan": {
    requiredFields: ["objective", "approach", "validation"],
  },
  "dispatch-handoff": {
    requiredFields: ["status", "inputArtifacts", "workerTasks"],
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
};

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
  const errors: ValidationError[] = [];

  for (const field of schema.requiredFields) {
    if (!(field in payload) || payload[field] === undefined || payload[field] === null) {
      errors.push({ field, message: `Missing required field: ${field}` });
    }
  }

  return { valid: errors.length === 0, errors };
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
  if (result.valid) return "✅ Artifact validation passed";
  const lines = ["❌ Artifact validation failed:"];
  for (const err of result.errors) {
    lines.push(`  - ${err.field}: ${err.message}`);
  }
  return lines.join("\n");
}
