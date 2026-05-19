import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, transitionIssuePhase } from "../../core/state";
import { writeArtifact } from "../../core/artifacts";

function setupIssueInSelfReview(root: string, issueId: string) {
  createIssueState({ root, issueId, issueType: "feature" });
  const stateFile = join(root, ".gxpm", "issues", issueId, "state.json");
  const raw = JSON.parse(readFileSync(stateFile, "utf8"));
  raw.currentPhase = "self-review";
  raw.phaseHistory.push({ phase: "self-review", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "ac-check" });
  writeFileSync(stateFile, JSON.stringify(raw, null, 2));

  // Create self-review artifact
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "self-review.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "self-review",
      writtenAt: "2026-05-19T00:00:00Z",
      payload: { findings: [], status: "draft" },
    }, null, 2),
  );

  // Create ship-readiness artifact
  writeFileSync(
    join(artDir, "ship-readiness.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "ship-readiness",
      writtenAt: "2026-05-19T00:00:00Z",
      payload: { checklist: [], status: "draft" },
    }, null, 2),
  );

  return stateFile;
}

function writeReviewReport(root: string, issueId: string, findings: Array<{ severity: string }>) {
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "review-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "review-report",
      writtenAt: "2026-05-19T00:00:00Z",
      payload: {
        army: "review-army",
        phase: "self-review",
        findings: findings.map((f, i) => ({
          role: "test-reviewer",
          severity: f.severity,
          location: `test.ts:${i + 1}`,
          rationale: `finding ${i + 1}`,
          recommendation: `fix ${i + 1}`,
        })),
      },
    }, null, 2),
  );
}

describe("Phase Gates (Army Mode)", () => {
  describe("self-review -> ship with blocking findings", () => {
    it("blocks transition when review-report contains blocking findings", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-block-"));
      setupIssueInSelfReview(root, "G-ARMY-BLOCK");
      writeReviewReport(root, "G-ARMY-BLOCK", [{ severity: "blocking" }]);

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-BLOCK", nextPhase: "ship" }),
      ).toThrow(/review-report contains 1 blocking finding/);

      rmSync(root, { recursive: true, force: true });
    });

    it("keeps issue in self-review phase after blocking", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-keep-"));
      setupIssueInSelfReview(root, "G-ARMY-KEEP");
      writeReviewReport(root, "G-ARMY-KEEP", [{ severity: "blocking" }]);

      try {
        transitionIssuePhase({ root, issueId: "G-ARMY-KEEP", nextPhase: "ship" });
      } catch {
        // expected
      }

      const stateFile = join(root, ".gxpm", "issues", "G-ARMY-KEEP", "state.json");
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.currentPhase).toBe("self-review");

      rmSync(root, { recursive: true, force: true });
    });

    it("appends gate.blocked event to events.jsonl", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-event-"));
      setupIssueInSelfReview(root, "G-ARMY-EVENT");
      writeReviewReport(root, "G-ARMY-EVENT", [{ severity: "blocking" }]);

      try {
        transitionIssuePhase({ root, issueId: "G-ARMY-EVENT", nextPhase: "ship" });
      } catch {
        // expected
      }

      const eventsPath = join(root, ".gxpm", "issues", "G-ARMY-EVENT", "events.jsonl");
      const events = readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const blockedEvent = events.find((e) => e.type === "gate.blocked");
      expect(blockedEvent).toBeTruthy();
      expect(blockedEvent.payload.blockingCount).toBe(1);

      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("self-review -> ship without blocking findings", () => {
    it("allows transition when no blocking findings exist", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-ok-"));
      setupIssueInSelfReview(root, "G-ARMY-OK");
      writeReviewReport(root, "G-ARMY-OK", [{ severity: "important" }, { severity: "suggestion" }]);

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-OK", nextPhase: "ship" }),
      ).not.toThrow();

      rmSync(root, { recursive: true, force: true });
    });

    it("transitions issue to ship phase", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-ship-"));
      setupIssueInSelfReview(root, "G-ARMY-SHIP");
      writeReviewReport(root, "G-ARMY-SHIP", [{ severity: "important" }]);

      transitionIssuePhase({ root, issueId: "G-ARMY-SHIP", nextPhase: "ship" });

      const stateFile = join(root, ".gxpm", "issues", "G-ARMY-SHIP", "state.json");
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.currentPhase).toBe("ship");

      rmSync(root, { recursive: true, force: true });
    });

    it("allows transition when review-report does not exist", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-noreport-"));
      setupIssueInSelfReview(root, "G-ARMY-NO");
      // Don't create review-report

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-NO", nextPhase: "ship" }),
      ).not.toThrow();

      rmSync(root, { recursive: true, force: true });
    });

    it("appends gate.passed event with review-report reference", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-passed-"));
      setupIssueInSelfReview(root, "G-ARMY-PASSED");
      writeReviewReport(root, "G-ARMY-PASSED", [{ severity: "important" }]);

      transitionIssuePhase({ root, issueId: "G-ARMY-PASSED", nextPhase: "ship" });

      const eventsPath = join(root, ".gxpm", "issues", "G-ARMY-PASSED", "events.jsonl");
      const events = readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const passedEvent = events.find((e) => e.type === "gate.passed");
      expect(passedEvent).toBeTruthy();
      expect(passedEvent.payload.fromPhase).toBe("self-review");
      expect(passedEvent.payload.toPhase).toBe("ship");

      rmSync(root, { recursive: true, force: true });
    });
  });
});
