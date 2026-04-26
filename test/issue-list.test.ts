import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIssues } from "../core/issues";
import { createIssueState, setIssueArchived, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";
import { enterPhase } from "./helpers/workflow";
import { output, runCli } from "./helpers/workflow";

describe("listIssues (core)", () => {
  test("returns empty array when no .gxpm/issues directory exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-empty-"));
    expect(listIssues({ root })).toEqual([]);
  });

  test("returns sorted entries for tracked issues", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-sorted-"));
    createIssueState({ root, issueId: "GXPM-A" });
    enterPhase(root, "GXPM-B", "implement");

    const entries = listIssues({ root });
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.issueId).sort()).toEqual(["GXPM-A", "GXPM-B"]);

    const a = entries.find((e) => e.issueId === "GXPM-A")!;
    expect(a.currentPhase).toBe("triage");
    expect(typeof a.updatedAt).toBe("string");

    const b = entries.find((e) => e.issueId === "GXPM-B")!;
    expect(b.currentPhase).toBe("implement");
  });

  test("skips directories without valid state.json", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-skip-"));
    createIssueState({ root, issueId: "GXPM-VALID" });
    // create stray dir
    mkdirSync(join(root, ".gxpm", "issues", "stray-dir"), { recursive: true });
    // create dir with corrupt state.json
    mkdirSync(join(root, ".gxpm", "issues", "GXPM-CORRUPT"), { recursive: true });
    writeFileSync(join(root, ".gxpm", "issues", "GXPM-CORRUPT", "state.json"), "not json");

    const entries = listIssues({ root });
    expect(entries.length).toBe(1);
    expect(entries[0].issueId).toBe("GXPM-VALID");
  });

  test("orders by updatedAt desc by default", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-order-"));
    createIssueState({ root, issueId: "GXPM-OLD" });
    // sleep tick to ensure timestamps differ
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    enterPhase(root, "GXPM-NEW", "plan");

    const entries = listIssues({ root });
    expect(entries[0].issueId).toBe("GXPM-NEW");
    expect(entries[1].issueId).toBe("GXPM-OLD");
  });
});

describe("listIssues filters", () => {
  test("hides archived issues by default", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-archived-hide-"));
    createIssueState({ root, issueId: "GXPM-A" });
    createIssueState({ root, issueId: "GXPM-B" });
    setIssueArchived({ root, issueId: "GXPM-A", archived: true });

    const entries = listIssues({ root });
    expect(entries.length).toBe(1);
    expect(entries[0].issueId).toBe("GXPM-B");
  });

  test("hides land-phase issues by default", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-land-hide-"));
    createIssueState({ root, issueId: "GXPM-ACTIVE" });
    // walk all the way to land
    enterPhase(root, "GXPM-LANDED", "qa");
    // additional artifact + transition for qa→land
    writeArtifact({ root, issueId: "GXPM-LANDED", type: "land-findings", payload: {} });
    transitionIssuePhase({ root, issueId: "GXPM-LANDED", nextPhase: "land" });

    const entries = listIssues({ root });
    expect(entries.length).toBe(1);
    expect(entries[0].issueId).toBe("GXPM-ACTIVE");
  });

  test("--all returns landed and archived", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-all-"));
    createIssueState({ root, issueId: "GXPM-X" });
    createIssueState({ root, issueId: "GXPM-Y" });
    setIssueArchived({ root, issueId: "GXPM-Y", archived: true });

    const entries = listIssues({ root, includeAll: true });
    expect(entries.length).toBe(2);
  });

  test("--archived returns only archived", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-arch-only-"));
    createIssueState({ root, issueId: "GXPM-X" });
    createIssueState({ root, issueId: "GXPM-Y" });
    setIssueArchived({ root, issueId: "GXPM-Y", archived: true });

    const entries = listIssues({ root, archivedOnly: true });
    expect(entries.length).toBe(1);
    expect(entries[0].issueId).toBe("GXPM-Y");
    expect(entries[0].archived).toBe(true);
  });
});

describe("gxpm issue archive CLI", () => {
  test("archive marks issue as archived; list hides it", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-archive-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-A"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-B"]).exitCode).toBe(0);

    const archive = runCli(root, ["issue", "archive", "GXPM-A"]);
    expect(archive.exitCode).toBe(0);
    expect(output(archive)).toContain("archived GXPM-A");

    const list = runCli(root, ["issue", "list"]);
    expect(output(list)).not.toContain("GXPM-A");
    expect(output(list)).toContain("GXPM-B");
  });

  test("--all flag in CLI shows archived", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-archive-cli-all-"));
    expect(runCli(root, ["issue", "create", "GXPM-C"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "archive", "GXPM-C"]).exitCode).toBe(0);

    const list = runCli(root, ["issue", "list", "--all"]);
    expect(output(list)).toContain("GXPM-C");
  });

  test("unarchive restores visibility", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-unarchive-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-D"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "archive", "GXPM-D"]).exitCode).toBe(0);

    const unarchive = runCli(root, ["issue", "unarchive", "GXPM-D"]);
    expect(unarchive.exitCode).toBe(0);
    expect(output(unarchive)).toContain("unarchived GXPM-D");

    const list = runCli(root, ["issue", "list"]);
    expect(output(list)).toContain("GXPM-D");
  });
});

describe("gxpm issue list CLI", () => {
  test("outputs table-like list", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-"));
    createIssueState({ root, issueId: "GXPM-1001" });
    enterPhase(root, "GXPM-1002", "implement");

    const r = runCli(root, ["issue", "list"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);
    expect(out).toContain("GXPM-1001");
    expect(out).toContain("GXPM-1002");
    expect(out).toContain("triage");
    expect(out).toContain("implement");
  });

  test("prints helpful message when no issues tracked", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-empty-"));
    const r = runCli(root, ["issue", "list"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toMatch(/no (active )?issues/);
  });

  test("--json outputs machine-readable list", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-json-"));
    createIssueState({ root, issueId: "GXPM-2001" });

    const r = runCli(root, ["issue", "list", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(output(r));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].issueId).toBe("GXPM-2001");
    expect(parsed[0].currentPhase).toBe("triage");
  });
});
