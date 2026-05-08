/**
 * Artifact Validator — structure checker for spec/plan/tasks artifacts.
 *
 * Validates that artifacts written via `gxpm artifact write` contain
 * required frontmatter and sections.
 */

export type ArtifactType = "spec" | "plan" | "tasks";

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
  requiredSections?: string[];
}

const ARTIFACT_SCHEMAS: Record<ArtifactType, ArtifactSchema> = {
  spec: {
    requiredFields: ["problem", "scope", "successCriteria"],
    requiredSections: ["Objective", "Tech Stack", "Success Criteria"],
  },
  plan: {
    requiredFields: ["summary", "approach", "validationCommands"],
    requiredSections: ["Approach", "Validation"],
  },
  tasks: {
    requiredFields: ["tasks"],
    requiredSections: ["Tasks"],
  },
};

/**
 * Validate an artifact payload against its type schema.
 */
export function validateArtifact(
  type: ArtifactType,
  payload: Record<string, unknown>
): ValidationResult {
  const schema = ARTIFACT_SCHEMAS[type];
  if (!schema) {
    return { valid: false, errors: [{ field: "type", message: `Unknown artifact type: ${type}` }] };
  }

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
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: [{ field: "payload", message: "Missing or invalid payload" }] };
  }

  return validateArtifact(type, payload as Record<string, unknown>);
}

function isArtifactType(value: string): value is ArtifactType {
  return value === "spec" || value === "plan" || value === "tasks";
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
