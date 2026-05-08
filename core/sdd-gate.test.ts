import { describe, it, expect } from "bun:test";
import { runSddGate, extractConstitutionCheck, formatSddGateResult } from "./sdd-gate";

describe("runSddGate", () => {
  it("passes when all automated checks are true", () => {
    const result = runSddGate({
      capabilityDeclared: true,
      testStrategyDefined: true,
      simplicityJustified: true,
      integrationPathClear: true,
    });
    expect(result.passed).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
    expect(result.passedChecks).toHaveLength(4);
  });

  it("fails when any automated check is false", () => {
    const result = runSddGate({
      capabilityDeclared: true,
      testStrategyDefined: false,
      simplicityJustified: true,
      integrationPathClear: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(0);
    expect(result.failedChecks[0].article).toContain("Test-First");
  });

  it("fails when all automated checks are missing", () => {
    const result = runSddGate({});
    expect(result.passed).toBe(false);
    expect(result.failedChecks).toHaveLength(4);
  });

  it("includes manual review articles", () => {
    const result = runSddGate({
      capabilityDeclared: true,
      testStrategyDefined: true,
      simplicityJustified: true,
      integrationPathClear: true,
    });
    expect(result.manualReviewArticles.length).toBeGreaterThan(0);
    expect(result.manualReviewArticles.some((a) => a.includes("Anti-Abstraction"))).toBe(true);
  });
});

describe("extractConstitutionCheck", () => {
  it("extracts valid constitution check", () => {
    const payload = {
      constitutionCheck: {
        capabilityDeclared: true,
        capabilitySlice: "execution.multi-agent",
        testStrategyDefined: true,
        testStrategy: "unit + integration",
        simplicityJustified: true,
        simplicityJustification: "3 modules",
        integrationPathClear: true,
        integrationPath: "real CLI in worktree",
      },
    };
    const result = extractConstitutionCheck(payload);
    expect(result).not.toBeNull();
    expect(result!.capabilityDeclared).toBe(true);
    expect(result!.capabilitySlice).toBe("execution.multi-agent");
  });

  it("returns null when constitutionCheck is missing", () => {
    expect(extractConstitutionCheck({})).toBeNull();
  });

  it("handles partial data with defaults", () => {
    const payload = { constitutionCheck: { capabilityDeclared: true } };
    const result = extractConstitutionCheck(payload);
    expect(result!.capabilityDeclared).toBe(true);
    expect(result!.testStrategyDefined).toBe(false);
  });
});

describe("formatSddGateResult", () => {
  it("formats passed result", () => {
    const result = runSddGate({
      capabilityDeclared: true,
      testStrategyDefined: true,
      simplicityJustified: true,
      integrationPathClear: true,
    });
    const text = formatSddGateResult(result);
    expect(text).toContain("PASSED");
    expect(text).toContain("✅");
  });

  it("formats failed result", () => {
    const result = runSddGate({ capabilityDeclared: false });
    const text = formatSddGateResult(result);
    expect(text).toContain("FAILED");
    expect(text).toContain("❌");
  });
});
