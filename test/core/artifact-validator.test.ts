import { describe, it, expect } from "bun:test";
import {
  validateArtifact,
  validateRawArtifact,
  formatValidationResult,
  type ArtifactType,
} from "../../core/artifact-validator";

describe("validateArtifact", () => {
  it("accepts valid spec payload", () => {
    const result = validateArtifact("spec", {
      problem: "Something is broken",
      scope: "Core module",
      successCriteria: ["Fix it"],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects spec payload missing required fields", () => {
    const result = validateArtifact("spec", {
      problem: "Something is broken",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("scope");
    expect(fields).toContain("successCriteria");
  });

  it("accepts valid plan payload", () => {
    const result = validateArtifact("plan", {
      summary: "Refactor auth",
      approach: "Extract service",
      validationCommands: ["bun test"],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects plan payload missing required fields", () => {
    const result = validateArtifact("plan", {
      summary: "Refactor auth",
    });
    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("approach");
    expect(fields).toContain("validationCommands");
  });

  it("accepts valid tasks payload", () => {
    const result = validateArtifact("tasks", {
      tasks: [{ id: "t1", description: "Do something" }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects tasks payload missing tasks field", () => {
    const result = validateArtifact("tasks", {});
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("tasks");
  });

  it("rejects unknown artifact type", () => {
    const result = validateArtifact("unknown" as ArtifactType, {});
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unknown artifact type");
  });
});

describe("validateRawArtifact", () => {
  it("accepts valid raw artifact", () => {
    const result = validateRawArtifact({
      schemaVersion: "1.0",
      issueId: "GXPM-114",
      type: "spec",
      payload: {
        problem: "Something is broken",
        scope: "Core module",
        successCriteria: ["Fix it"],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects raw artifact missing type", () => {
    const result = validateRawArtifact({
      payload: { problem: "x" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Missing artifact type");
  });

  it("rejects raw artifact with unsupported type", () => {
    const result = validateRawArtifact({
      type: "unknown",
      payload: { problem: "x" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unsupported artifact type");
  });

  it("rejects raw artifact missing payload", () => {
    const result = validateRawArtifact({
      type: "spec",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Missing or invalid payload");
  });
});

describe("formatValidationResult", () => {
  it("formats success", () => {
    const out = formatValidationResult({ valid: true, errors: [] });
    expect(out).toContain("passed");
  });

  it("formats failure", () => {
    const out = formatValidationResult({
      valid: false,
      errors: [{ field: "x", message: "bad" }],
    });
    expect(out).toContain("failed");
    expect(out).toContain("x: bad");
  });
});
