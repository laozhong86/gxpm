import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(a.issueType).toBe("feature");
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

  test("defaults to five feature issues and hides meta or spike issues", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-default-focus-"));
    for (let i = 1; i <= 6; i += 1) {
      createIssueState({ root, issueId: `GXPM-F${i}`, issueType: "feature" });
    }
    createIssueState({ root, issueId: "GXPM-META", issueType: "meta" });
    createIssueState({ root, issueId: "GXPM-SPIKE", issueType: "spike" });

    const entries = listIssues({ root });

    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => entry.issueType === "feature")).toBe(true);
    expect(entries.map((entry) => entry.issueId)).not.toContain("GXPM-META");
    expect(entries.map((entry) => entry.issueId)).not.toContain("GXPM-SPIKE");
  });

  test("treats states without issueType as feature", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-legacy-type-"));
    createIssueState({ root, issueId: "GXPM-LEGACY" });
    const statePath = join(root, ".gxpm", "issues", "GXPM-LEGACY", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    delete state.issueType;
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const entries = listIssues({ root });

    expect(entries).toHaveLength(1);
    expect(entries[0].issueId).toBe("GXPM-LEGACY");
    expect(entries[0].issueType).toBe("feature");
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
    createIssueState({ root, issueId: "GXPM-Y", issueType: "meta" });
    setIssueArchived({ root, issueId: "GXPM-Y", archived: true });

    const entries = listIssues({ root, includeAll: true });
    expect(entries.length).toBe(2);
    expect(entries.find((entry) => entry.issueId === "GXPM-Y")?.issueType).toBe("meta");
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

  test("--type returns only the requested issue type", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-type-filter-"));
    createIssueState({ root, issueId: "GXPM-FEATURE" });
    createIssueState({ root, issueId: "GXPM-META", issueType: "meta" });

    const entries = listIssues({ root, types: ["meta"] });

    expect(entries).toHaveLength(1);
    expect(entries[0].issueId).toBe("GXPM-META");
    expect(entries[0].issueType).toBe("meta");
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

  test("--all flag in CLI shows meta issues", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-all-type-"));
    expect(runCli(root, ["issue", "create", "GXPM-F", "--type", "feature"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-M", "--type", "meta"]).exitCode).toBe(0);

    const list = runCli(root, ["issue", "list", "--all"]);
    const out = output(list);
    expect(out).toContain("GXPM-F");
    expect(out).toContain("GXPM-M");
    expect(out).toContain("meta");
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
    expect(parsed[0].issueType).toBe("feature");
    expect(parsed[0].currentPhase).toBe("triage");
  });

  test("defaults to at most five feature rows", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-default-focus-"));
    for (let i = 1; i <= 6; i += 1) {
      expect(runCli(root, ["issue", "create", `GXPM-F${i}`]).exitCode).toBe(0);
    }
    expect(runCli(root, ["issue", "create", "GXPM-M", "--type", "meta"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "list"]);
    expect(r.exitCode).toBe(0);
    const rows = output(r).trim().split("\n").slice(1);
    expect(rows).toHaveLength(5);
    expect(output(r)).not.toContain("GXPM-M");
    expect(rows.every((row) => row.includes("feature"))).toBe(true);
  });

  test("--type and --limit control list output", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-list-cli-type-limit-"));
    expect(runCli(root, ["issue", "create", "GXPM-M1", "--type", "meta"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-M2", "--type", "meta"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "create", "GXPM-F1"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "list", "--type", "meta", "--limit", "1"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);
    const rows = out.trim().split("\n").slice(1);
    expect(rows).toHaveLength(1);
    expect(out).toContain("meta");
    expect(out).not.toContain("GXPM-F1");
  });
});
