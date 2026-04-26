import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIssues } from "../core/issues";
import { createIssueState, transitionIssuePhase } from "../core/state";
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
    expect(output(r)).toContain("no issues");
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
