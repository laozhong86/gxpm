import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../../core/state";
import { initializeCleanup } from "../../core/cleanup";

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
      schemaVersion: 1, issueId, type: "self-review",
      writtenAt: "2026-05-19T00:00:00Z",
      payload: { findings: [], status: "draft" },
    }, null, 2),
  );
  return stateFile;
}

describe("Cleanup", () => {
  it("initializes cleanup-report artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cleanup-"));
    setupIssueInSelfReview(root, "G-CLN-1");

    initializeCleanup({ root, issueId: "G-CLN-1" });

    const path = join(root, ".gxpm", "issues", "G-CLN-1", "artifacts", "cleanup-report.json");
    expect(existsSync(path)).toBe(true);

    const report = JSON.parse(readFileSync(path, "utf8"));
    expect(report.type).toBe("cleanup-report");
    expect(report.payload.duplicatesExtracted).toBeArray();
    expect(report.payload.renamesUnified).toBeArray();
    expect(report.payload.interfacesAligned).toBeArray();
    expect(report.payload.deadCodeRemoved).toBeArray();
    expect(report.payload.testsDeduplicated).toBeArray();

    rmSync(root, { recursive: true, force: true });
  });
});
