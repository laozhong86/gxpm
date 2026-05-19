import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../../core/state";
import { initializeSelfReview } from "../../core/self-review";

function setupIssueInAcCheck(root: string, issueId: string) {
  createIssueState({ root, issueId, issueType: "feature" });
  const stateFile = join(root, ".gxpm", "issues", issueId, "state.json");
  const raw = JSON.parse(readFileSync(stateFile, "utf8"));
  raw.currentPhase = "ac-check";
  raw.phaseHistory.push({ phase: "ac-check", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "local-verify" });
  writeFileSync(stateFile, JSON.stringify(raw, null, 2));

  // Create acceptance-check artifact
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "acceptance-check.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "acceptance-check",
      writtenAt: "2026-05-19T00:00:00Z",
      payload: { criteria: [], status: "draft" },
    }, null, 2),
  );

  return stateFile;
}

describe("Self Review (Army Mode)", () => {
  describe("backward compatibility", () => {
    it("does not create review-report.json without army flag", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-sr-compat-"));
      setupIssueInAcCheck(root, "G-SR-COMPAT");

      initializeSelfReview({ root, issueId: "G-SR-COMPAT", army: false });

      const reviewReportPath = join(root, ".gxpm", "issues", "G-SR-COMPAT", "artifacts", "review-report.json");
      expect(existsSync(reviewReportPath)).toBe(false);

      const selfReviewPath = join(root, ".gxpm", "issues", "G-SR-COMPAT", "artifacts", "self-review.json");
      expect(existsSync(selfReviewPath)).toBe(true);

      rmSync(root, { recursive: true, force: true });
    });

    it("only creates self-review.json artifact without army flag", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-sr-only-"));
      setupIssueInAcCheck(root, "G-SR-ONLY");

      initializeSelfReview({ root, issueId: "G-SR-ONLY" });

      const artDir = join(root, ".gxpm", "issues", "G-SR-ONLY", "artifacts");
      const files = existsSync(artDir) ? readFileSync(join(artDir, "self-review.json"), "utf8") : null;
      expect(files).toBeTruthy();

      rmSync(root, { recursive: true, force: true });
    });

    it("creates review-report.json with army flag", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-sr-army-"));
      setupIssueInAcCheck(root, "G-SR-ARMY");

      initializeSelfReview({ root, issueId: "G-SR-ARMY", army: true });

      const reviewReportPath = join(root, ".gxpm", "issues", "G-SR-ARMY", "artifacts", "review-report.json");
      expect(existsSync(reviewReportPath)).toBe(true);

      const report = JSON.parse(readFileSync(reviewReportPath, "utf8"));
      expect(report.type).toBe("review-report");
      expect(report.payload.army).toBe("review-army");
      expect(report.payload.agents).toBeArray();
      expect(report.payload.agents.length).toBe(5);

      rmSync(root, { recursive: true, force: true });
    });

    it("review-report contains agent metadata with army flag", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-sr-meta-"));
      setupIssueInAcCheck(root, "G-SR-META");

      initializeSelfReview({ root, issueId: "G-SR-META", army: true });

      const reviewReportPath = join(root, ".gxpm", "issues", "G-SR-META", "artifacts", "review-report.json");
      const report = JSON.parse(readFileSync(reviewReportPath, "utf8"));

      for (const agent of report.payload.agents) {
        expect(agent.name).toBeTruthy();
        expect(agent.role).toBeTruthy();
        expect(agent.description).toBeTruthy();
      }

      rmSync(root, { recursive: true, force: true });
    });
  });
});
