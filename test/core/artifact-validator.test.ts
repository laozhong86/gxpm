import { describe, it, expect } from "bun:test";
import {
  validateArtifact,
  validateRawArtifact,
  formatValidationResult,
  listValidatedArtifactTypes,
} from "../../core/artifact-validator";
import { ARTIFACT_TYPES } from "../../core/artifacts";
import { GATE_ARTIFACT_TYPES } from "../../core/phase-gates";

describe("validateArtifact", () => {
  it("covers every gxpm artifact type", () => {
    expect(listValidatedArtifactTypes()).toEqual([...ARTIFACT_TYPES]);
  });

  it("covers every phase-gate artifact", () => {
    const validated = new Set(listValidatedArtifactTypes());
    for (const artifactType of GATE_ARTIFACT_TYPES) {
      expect(validated).toContain(artifactType);
    }
  });

  it("accepts valid acceptance-contract payload", () => {
    const result = validateArtifact("acceptance-contract", {
      status: "finalized",
      criteria: ["Must document the behavior"],
      summary: "Scope is clear",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects acceptance-contract payload missing required fields", () => {
    const result = validateArtifact("acceptance-contract", {
      status: "finalized",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("criteria");
  });

  it("accepts valid implementation-plan payload", () => {
    const result = validateArtifact("implementation-plan", {
      objective: "Refactor auth",
      approach: "Extract service",
      validation: ["bun test"],
      status: "finalized",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects implementation-plan payload missing required fields", () => {
    const result = validateArtifact("implementation-plan", {
      objective: "Refactor auth",
    });
    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("approach");
    expect(fields).toContain("validation");
  });

  it("accepts permissive support artifacts", () => {
    const result = validateArtifact("triage-report", {
      summary: "Research notes",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts gate artifact initializer payloads", () => {
    const cases = [
      ["dispatch-handoff", { status: "draft", inputArtifacts: [], workerTasks: [] }],
      ["local-verify", { status: "draft", commands: [], results: [] }],
      ["acceptance-check", { status: "draft", criteria: [], findings: [] }],
      ["self-review", { status: "draft", reviewedArtifacts: [], findings: [] }],
      ["ship-readiness", { status: "draft", checklist: [], rollbackPlan: {} }],
      ["pr-check", { status: "draft", pullRequest: "", reviewFindings: [] }],
      ["verify-findings", { status: "draft", findings: [], risks: [] }],
      ["qa-findings", { status: "draft", browserEvidence: [], findings: [] }],
      ["land-findings", { status: "draft", landReady: false, mergePlan: "" }],
    ] as const;

    for (const [type, payload] of cases) {
      expect(validateArtifact(type, payload).valid).toBe(true);
    }
  });

  it("rejects unknown artifact type", () => {
    const result = validateArtifact("unknown", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Invalid artifact type");
  });
});

describe("validateRawArtifact", () => {
  it("accepts valid raw artifact", () => {
    const result = validateRawArtifact({
      schemaVersion: "1.0",
      issueId: "GXPM-114",
      type: "acceptance-contract",
      payload: {
        status: "finalized",
        criteria: ["Fix it"],
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
      type: "acceptance-contract",
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
