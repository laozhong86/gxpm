import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDogfoodCheck } from "../../scripts/dogfood-check";

function seedIssue(
  root: string,
  issueId: string,
  state: { currentPhase: string; phaseHistory: Array<{ phase: string; enteredAt: string }> },
) {
  const issueDir = join(root, ".gxpm", "issues", issueId);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(
    join(issueDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      createdAt: "2026-05-14T00:00:00Z",
      updatedAt: "2026-05-14T00:00:00Z",
      stateRoot: `.gxpm/issues/${issueId}`,
      artifactRoot: `.gxpm/issues/${issueId}/artifacts`,
      ...state,
    }, null, 2),
  );
}

describe("runDogfoodCheck", () => {
  it("flags post-cutoff issues that skipped specify", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dogfood-violation-"));
    seedIssue(root, "GXPM-200", {
      currentPhase: "implement",
      phaseHistory: [
        { phase: "triage", enteredAt: "2026-06-01T00:00:00Z" },
        { phase: "plan", enteredAt: "2026-06-01T01:00:00Z" },
        { phase: "dispatch", enteredAt: "2026-06-01T02:00:00Z" },
        { phase: "implement", enteredAt: "2026-06-01T03:00:00Z" },
      ],
    });
    const report = runDogfoodCheck(root);
    expect(report.scanned).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].issueId).toBe("GXPM-200");
    expect(report.violations[0].currentPhase).toBe("implement");
    rmSync(root, { recursive: true, force: true });
  });

  it("counts pre-cutoff issues as legacy exempt", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dogfood-legacy-"));
    seedIssue(root, "GXPM-100", {
      currentPhase: "implement",
      phaseHistory: [
        { phase: "triage", enteredAt: "2025-12-01T00:00:00Z" },
        { phase: "implement", enteredAt: "2025-12-04T00:00:00Z" },
      ],
    });
    const report = runDogfoodCheck(root);
    expect(report.legacyExempt).toBe(1);
    expect(report.violations).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("counts post-cutoff issues with specify in history as compliant", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dogfood-ok-"));
    seedIssue(root, "GXPM-201", {
      currentPhase: "implement",
      phaseHistory: [
        { phase: "triage", enteredAt: "2026-06-01T00:00:00Z" },
        { phase: "plan", enteredAt: "2026-06-01T01:00:00Z" },
        { phase: "dispatch", enteredAt: "2026-06-01T02:00:00Z" },
        { phase: "specify", enteredAt: "2026-06-01T03:00:00Z" },
        { phase: "implement", enteredAt: "2026-06-01T04:00:00Z" },
      ],
    });
    const report = runDogfoodCheck(root);
    expect(report.compliant).toBe(1);
    expect(report.violations).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores issues still in pre-implement phases", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dogfood-early-"));
    seedIssue(root, "GXPM-202", {
      currentPhase: "dispatch",
      phaseHistory: [
        { phase: "triage", enteredAt: "2026-06-01T00:00:00Z" },
        { phase: "plan", enteredAt: "2026-06-01T01:00:00Z" },
        { phase: "dispatch", enteredAt: "2026-06-01T02:00:00Z" },
      ],
    });
    const report = runDogfoodCheck(root);
    expect(report.compliant).toBe(1);
    expect(report.violations).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty report when no .gxpm/issues exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-dogfood-noissues-"));
    const report = runDogfoodCheck(root);
    expect(report.scanned).toBe(0);
    expect(report.violations).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });
});
