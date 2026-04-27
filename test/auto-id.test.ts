import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNextAvailableIssueId, recentLandedIssues } from "../core/issues";
import { createIssueState, readIssueState, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { enterPhase, output, runCli } from "./helpers/workflow";

describe("getNextAvailableIssueId", () => {
  test("returns GXPM-1 in empty repo", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-empty-"));
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-1");
  });

  test("returns next after the highest existing id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-seq-"));
    createIssueState({ root, issueId: "GXPM-1" });
    createIssueState({ root, issueId: "GXPM-3" });
    createIssueState({ root, issueId: "GXPM-7" });
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-8");
  });

  test("ignores non-matching dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-mixed-"));
    createIssueState({ root, issueId: "GXPM-2" });
    createIssueState({ root, issueId: "GXG-99" }); // different prefix
    createIssueState({ root, issueId: "GXPM-tracker-019" }); // non-numeric suffix
    expect(getNextAvailableIssueId({ root })).toBe("GXPM-3");
  });

  test("custom prefix supported", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-autoid-pfx-"));
    createIssueState({ root, issueId: "GXG-5" });
    createIssueState({ root, issueId: "GXG-7" });
    expect(getNextAvailableIssueId({ root, prefix: "GXG" })).toBe("GXG-8");
  });
});

describe("recentLandedIssues", () => {
  test("returns empty when no landed issues", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-empty-"));
    createIssueState({ root, issueId: "GXPM-1" });
    expect(recentLandedIssues({ root })).toEqual([]);
  });

  test("returns landed issues sorted by updatedAt desc", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-many-"));
    // Walk one to land using helpers
    enterPhase(root, "GXPM-FIRST", "qa");
    writeArtifact({ root, issueId: "GXPM-FIRST", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-FIRST", nextPhase: "land" });

    // Wait a tick to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 5));

    enterPhase(root, "GXPM-SECOND", "qa");
    writeArtifact({ root, issueId: "GXPM-SECOND", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-SECOND", nextPhase: "land" });

    const recent = recentLandedIssues({ root, limit: 5 });
    expect(recent.length).toBe(2);
    expect(recent[0].issueId).toBe("GXPM-SECOND");
    expect(recent[1].issueId).toBe("GXPM-FIRST");
  });

  test("respects limit", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-recent-limit-"));
    for (const id of ["GXPM-A", "GXPM-B", "GXPM-C"]) {
      enterPhase(root, id, "qa");
      writeArtifact({ root, issueId: id, type: "land-findings", payload: {} });
      transitionIssuePhase({ root, issueId: id, nextPhase: "land" });
    }
    expect(recentLandedIssues({ root, limit: 2 }).length).toBe(2);
  });
});

describe("gxpm issue create --auto-id CLI", () => {
  test("picks next available id when --auto-id passed", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-auto-"));
    expect(runCli(root, ["issue", "create", "GXPM-1"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-3"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "create", "--auto-id"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("created GXPM-4");
  });

  test("writes explicit issue type when --type is passed", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-type-"));

    const r = runCli(root, ["issue", "create", "--auto-id", "--type", "meta"]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("created GXPM-1");
    expect(readIssueState({ root, issueId: "GXPM-1" }).issueType).toBe("meta");
  });

  test("rejects mixing a literal issue id with --auto-id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-auto-positional-"));

    const r = runCli(root, ["issue", "create", "GXPM-1", "--auto-id"]);

    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("Usage: gxpm issue create");
  });
});

describe("gxpm issue list --recent CLI", () => {
  test("--recent N shows landed issues regardless of default filter", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-recent-"));
    enterPhase(root, "GXPM-LAND-A", "qa");
    writeArtifact({ root, issueId: "GXPM-LAND-A", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-LAND-A", nextPhase: "land" });

    const r = runCli(root, ["issue", "list", "--recent", "5"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("GXPM-LAND-A");
    expect(output(r)).toContain("land");
  });

  test("--recent rejects type and limit filters", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-recent-filter-"));

    const typeFilter = runCli(root, ["issue", "list", "--recent", "5", "--type", "meta"]);
    const limitFilter = runCli(root, ["issue", "list", "--recent", "5", "--limit", "2"]);

    expect(typeFilter.exitCode).toBe(1);
    expect(limitFilter.exitCode).toBe(1);
    expect(output(typeFilter)).toContain("--recent cannot be combined");
    expect(output(limitFilter)).toContain("--recent cannot be combined");
  });
});
