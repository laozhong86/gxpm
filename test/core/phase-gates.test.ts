import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, transitionIssuePhase } from "../../core/state";
import { writeArtifact } from "../../core/artifacts";
import { initializeCleanup } from "../../core/cleanup";
import { initializeShipReadiness } from "../../core/ship";

function setupIssueInCleanup(root: string, issueId: string) {
  createIssueState({ root, issueId, issueType: "feature" });
  const stateFile = join(root, ".gxpm", "issues", issueId, "state.json");
  const raw = JSON.parse(readFileSync(stateFile, "utf8"));

  // Set up phase history: triage -> plan -> dispatch -> specify -> implement -> local-verify -> ac-check -> self-review -> cleanup
  raw.currentPhase = "cleanup";
  raw.phaseHistory = [
    { phase: "triage", enteredAt: "2026-05-19T00:00:00Z", fromPhase: null },
    { phase: "plan", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "triage" },
    { phase: "dispatch", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "plan" },
    { phase: "specify", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "dispatch" },
    { phase: "implement", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "specify" },
    { phase: "local-verify", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "implement" },
    { phase: "ac-check", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "local-verify" },
    { phase: "self-review", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "ac-check" },
    { phase: "cleanup", enteredAt: "2026-05-19T00:00:00Z", fromPhase: "self-review" },
  ];
  writeFileSync(stateFile, JSON.stringify(raw, null, 2));

  // Create artifacts
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });

  const artifacts = [
    { type: "acceptance-contract", payload: { status: "draft" } },
    { type: "implementation-plan", payload: { status: "draft" } },
    { type: "dispatch-handoff", payload: { status: "draft" } },
    { type: "behavior-spec", payload: { confirmedAt: "2026-05-19T00:00:00Z" } },
    { type: "local-verify", payload: { status: "draft" } },
    { type: "acceptance-check", payload: { status: "draft" } },
    { type: "self-review", payload: { findings: [], status: "draft" } },
    { type: "cleanup-report", payload: { duplicatesExtracted: [], renamesUnified: [], interfacesAligned: [], deadCodeRemoved: [], testsDeduplicated: [], status: "draft" } },
  ];

  for (const art of artifacts) {
    writeFileSync(
      join(artDir, `${art.type}.json`),
      JSON.stringify({ schemaVersion: 1, issueId, type: art.type, writtenAt: "2026-05-19T00:00:00Z", payload: art.payload }, null, 2),
    );
  }

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
  describe("cleanup -> ship with blocking findings", () => {
    it("blocks transition when review-report contains blocking findings", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-block-"));
      setupIssueInCleanup(root, "G-ARMY-BLOCK");
      writeReviewReport(root, "G-ARMY-BLOCK", [{ severity: "blocking" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-BLOCK" });

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-BLOCK", nextPhase: "ship" }),
      ).toThrow(/review-report contains 1 blocking finding/);

      rmSync(root, { recursive: true, force: true });
    });

    it("keeps issue in cleanup phase after blocking", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-keep-"));
      setupIssueInCleanup(root, "G-ARMY-KEEP");
      writeReviewReport(root, "G-ARMY-KEEP", [{ severity: "blocking" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-KEEP" });

      try {
        transitionIssuePhase({ root, issueId: "G-ARMY-KEEP", nextPhase: "ship" });
      } catch {
        // expected
      }

      const stateFile = join(root, ".gxpm", "issues", "G-ARMY-KEEP", "state.json");
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.currentPhase).toBe("cleanup");

      rmSync(root, { recursive: true, force: true });
    });

    it("appends gate.blocked event to events.jsonl", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-event-"));
      setupIssueInCleanup(root, "G-ARMY-EVENT");
      writeReviewReport(root, "G-ARMY-EVENT", [{ severity: "blocking" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-EVENT" });

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

  describe("cleanup -> ship without blocking findings", () => {
    it("allows transition when no blocking findings exist", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-ok-"));
      setupIssueInCleanup(root, "G-ARMY-OK");
      writeReviewReport(root, "G-ARMY-OK", [{ severity: "important" }, { severity: "suggestion" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-OK" });

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-OK", nextPhase: "ship" }),
      ).not.toThrow();

      rmSync(root, { recursive: true, force: true });
    });

    it("transitions issue to ship phase", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-ship-"));
      setupIssueInCleanup(root, "G-ARMY-SHIP");
      writeReviewReport(root, "G-ARMY-SHIP", [{ severity: "important" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-SHIP" });

      transitionIssuePhase({ root, issueId: "G-ARMY-SHIP", nextPhase: "ship" });

      const stateFile = join(root, ".gxpm", "issues", "G-ARMY-SHIP", "state.json");
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.currentPhase).toBe("ship");

      rmSync(root, { recursive: true, force: true });
    });

    it("allows transition when review-report does not exist", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-noreport-"));
      setupIssueInCleanup(root, "G-ARMY-NO");
      // Don't create review-report
      initializeShipReadiness({ root, issueId: "G-ARMY-NO" });

      expect(() =>
        transitionIssuePhase({ root, issueId: "G-ARMY-NO", nextPhase: "ship" }),
      ).not.toThrow();

      rmSync(root, { recursive: true, force: true });
    });

    it("appends gate.passed event with review-report reference", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-army-passed-"));
      setupIssueInCleanup(root, "G-ARMY-PASSED");
      writeReviewReport(root, "G-ARMY-PASSED", [{ severity: "important" }]);
      initializeShipReadiness({ root, issueId: "G-ARMY-PASSED" });

      transitionIssuePhase({ root, issueId: "G-ARMY-PASSED", nextPhase: "ship" });

      const eventsPath = join(root, ".gxpm", "issues", "G-ARMY-PASSED", "events.jsonl");
      const events = readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const passedEvent = events.find((e) => e.type === "gate.passed");
      expect(passedEvent).toBeTruthy();
      expect(passedEvent.payload.fromPhase).toBe("cleanup");
      expect(passedEvent.payload.toPhase).toBe("ship");

      rmSync(root, { recursive: true, force: true });
    });
  });
});
