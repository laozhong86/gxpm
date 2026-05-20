import { describe, test, expect } from "bun:test";
import { validateArtifact, formatValidationResult } from "../core/artifact-validator";

describe("GXPM-166: validator surfaces wiki-only evidence warning", () => {
  test("scn-01: verify-findings with wiki-only findings → valid=true + warning", () => {
    const r = validateArtifact("verify-findings", {
      status: "ok",
      findings: ["wiki://process/foo", "wiki://repo/gxpm"],
      risks: [],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.join("")).toContain("wiki-only");
  });

  test("scn-02: verify-findings with git diff in findings → no warning", () => {
    const r = validateArtifact("verify-findings", {
      status: "ok",
      findings: ["ran git diff origin/main...HEAD; 5 files changed"],
      risks: [],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings ?? []).toEqual([]);
  });

  test("scn-03: other artifact types don't surface this warning", () => {
    const r = validateArtifact("implementation-plan", {
      objective: "x",
      approach: "wiki://foo",
      validation: "wiki://bar",
    });
    expect(r.valid).toBe(true);
    expect(r.warnings ?? []).toEqual([]);
  });

  test("scn-04: formatValidationResult surfaces warning lines", () => {
    const r = validateArtifact("qa-findings", {
      status: "ok",
      browserEvidence: ["wiki://qa/check"],
      findings: ["wiki://qa/check"],
    });
    const out = formatValidationResult(r);
    expect(out).toContain("Warning:");
    expect(out).toContain("wiki-only");
  });

  test("bonus: pr-check with non-wiki reviewFindings → no warning", () => {
    const r = validateArtifact("pr-check", {
      status: "ok",
      pullRequest: { url: "https://github.com/x/y/pull/1" },
      reviewFindings: ["bun test passed; see test/foo.test.ts"],
    });
    expect(r.warnings ?? []).toEqual([]);
  });
});
