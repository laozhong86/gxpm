import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCleanupDanglingLandedCommand } from "../scripts/cleanup-dangling-landed-issues";

// Feature: scripts/cleanup-dangling-landed-issues.ts safely cleans up source dirs
//          left behind by historical cleanup land runs (pre-GXPM-192 fix)
//
// As a gxpm operator
// I want to remove residual .gxpm/issues/<id>/ source dirs whose archive copy is
//   complete and consistent
// So that the issue list and event log are no longer split between source and archive

describe("scripts/cleanup-dangling-landed-issues", () => {
  // Scenario (scn-05): --dry-run lists every (source ∩ archive) pair as a candidate
  //   Given .gxpm/issues/ contains 3 issue dirs whose archive copies also exist
  //   And  .gxpm/archive/<date>-<id>/ exists for each of those 3 issues
  //   And  .gxpm/issues/ also contains 2 issue dirs that have no archive (active issues)
  //   When the operator runs the script with no arguments
  //   Then the script exits with status zero
  //   And  stdout lists exactly the 3 dangling issue ids as candidates
  //   And  no filesystem change occurs
  test("scn-05: --dry-run lists exactly the dangling candidates and does not delete", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-dangling-scn05-"));
    const issuesRoot = join(repo, ".gxpm", "issues");
    const archiveRoot = join(repo, ".gxpm", "archive");
    mkdirSync(issuesRoot, { recursive: true });
    mkdirSync(archiveRoot, { recursive: true });

    // 3 dangling: source + archive both exist with a strict-prefix events log
    const dangling = ["GXPM-401", "GXPM-402", "GXPM-403"];
    for (const id of dangling) {
      createDanglingIssue(repo, id, {
        archiveEvents: [{ type: "cleanup.executed" }],
        sourceTailEvents: [{ type: "gitnexus.reindex.triggered" }],
      });
    }

    // 2 active issues: source only, no archive
    for (const id of ["GXPM-410", "GXPM-411"]) {
      createActiveIssue(repo, id);
    }

    const result = runCleanupDanglingLandedCommand({ root: repo });

    expect(result.mode).toBe("dry-run");
    expect(result.candidates.sort()).toEqual(dangling.sort());
    expect(result.deleted).toEqual([]);

    // No filesystem change occurred.
    for (const id of [...dangling, "GXPM-410", "GXPM-411"]) {
      expect(existsSync(join(issuesRoot, id))).toBe(true);
    }
  });

  // Scenario (scn-06): --execute happy path deletes source dirs whose archive is a strict prefix
  //   Given a dangling issue whose archive events.jsonl is a strict prefix of source events.jsonl
  //   And  the source's trailing events beyond the archive snapshot are only gitnexus.reindex.triggered/failed
  //   When the operator runs the script with --execute
  //   Then the script exits with status zero
  //   And  the source dir .gxpm/issues/<id>/ no longer exists
  //   And  the archive's events.jsonl now contains the previously-source-only reindex events appended in order
  //   And  the archive's state.json and artifacts/ remain unchanged
  test("scn-06: --execute backfills trailing reindex events into archive then deletes source", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-dangling-scn06-"));
    const issuesRoot = join(repo, ".gxpm", "issues");
    const archiveRoot = join(repo, ".gxpm", "archive");
    mkdirSync(issuesRoot, { recursive: true });
    mkdirSync(archiveRoot, { recursive: true });

    createDanglingIssue(repo, "GXPM-501", {
      archiveEvents: [
        { type: "issue.created" },
        { type: "cleanup.executed" },
      ],
      sourceTailEvents: [
        { type: "gitnexus.reindex.triggered" },
      ],
    });

    const beforeStateJson = readFileSync(
      join(archiveRoot, "2026-05-21-GXPM-501", "state.json"),
      "utf8",
    );

    const result = runCleanupDanglingLandedCommand({ root: repo, execute: true });

    expect(result.mode).toBe("execute");
    expect(result.deleted).toEqual(["GXPM-501"]);
    expect(result.skipped).toEqual([]);

    expect(existsSync(join(issuesRoot, "GXPM-501"))).toBe(false);

    const archiveDir = join(archiveRoot, "2026-05-21-GXPM-501");
    const archiveTypes = readJsonlTypes(join(archiveDir, "events.jsonl"));
    expect(archiveTypes).toEqual([
      "issue.created",
      "cleanup.executed",
      "gitnexus.reindex.triggered",
    ]);

    // state.json untouched
    expect(readFileSync(join(archiveDir, "state.json"), "utf8")).toBe(beforeStateJson);
  });

  // Scenario (scn-07): script skips any dangling whose archive is not a strict prefix of source
  //   Given a dangling issue whose archive lacks a cleanup.executed event
  //   And  another dangling issue whose source has an extra event that is NOT gitnexus.reindex.*
  //   When the operator runs the script with --execute
  //   Then the script exits with status zero
  //   And  both source dirs remain intact (no deletion)
  //   And  stdout reports each skipped issue with a specific reason ("missing cleanup.executed in archive" / "non-reindex events in source tail")
  test("scn-07: --execute skips dirs whose archive is not a strict prefix or trailing events are non-reindex", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-dangling-scn07-"));
    const issuesRoot = join(repo, ".gxpm", "issues");
    const archiveRoot = join(repo, ".gxpm", "archive");
    mkdirSync(issuesRoot, { recursive: true });
    mkdirSync(archiveRoot, { recursive: true });

    // A: archive lacks cleanup.executed
    createDanglingIssue(repo, "GXPM-601", {
      archiveEvents: [{ type: "issue.created" }],
      sourceTailEvents: [],
    });

    // B: source tail has a non-reindex event
    createDanglingIssue(repo, "GXPM-602", {
      archiveEvents: [{ type: "issue.created" }, { type: "cleanup.executed" }],
      sourceTailEvents: [
        { type: "gitnexus.reindex.triggered" },
        { type: "checkpoint.created" },
      ],
    });

    const result = runCleanupDanglingLandedCommand({ root: repo, execute: true });

    expect(result.deleted).toEqual([]);
    expect(result.skipped.length).toBe(2);
    const byId = new Map(result.skipped.map((s) => [s.issueId, s.reason]));
    expect(byId.get("GXPM-601")).toBe("missing cleanup.executed in archive");
    expect(byId.get("GXPM-602")).toBe("non-reindex events in source tail");

    // Both source dirs remain intact.
    expect(existsSync(join(issuesRoot, "GXPM-601"))).toBe(true);
    expect(existsSync(join(issuesRoot, "GXPM-602"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface EventLike {
  type: string;
  payload?: Record<string, unknown>;
}

function eventLine(issueId: string, event: EventLike, index: number): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    type: event.type,
    issueId,
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    payload: event.payload ?? {},
  })}\n`;
}

function writeEventsJsonl(dir: string, issueId: string, events: EventLike[]): void {
  let body = "";
  events.forEach((e, i) => {
    body += eventLine(issueId, e, i);
  });
  writeFileSync(join(dir, "events.jsonl"), body);
}

function readJsonlTypes(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => (JSON.parse(line) as { type: string }).type);
}

function createDanglingIssue(
  repo: string,
  issueId: string,
  opts: { archiveEvents: EventLike[]; sourceTailEvents: EventLike[] },
): void {
  const sourceDir = join(repo, ".gxpm", "issues", issueId);
  const archiveDir = join(repo, ".gxpm", "archive", `2026-05-21-${issueId}`);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(sourceDir, "artifacts"), { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(join(archiveDir, "artifacts"), { recursive: true });

  writeFileSync(
    join(sourceDir, "state.json"),
    JSON.stringify({ issueId, currentPhase: "land" }),
  );
  writeFileSync(
    join(archiveDir, "state.json"),
    JSON.stringify({ issueId, currentPhase: "land" }),
  );

  writeEventsJsonl(archiveDir, issueId, opts.archiveEvents);
  writeEventsJsonl(sourceDir, issueId, [...opts.archiveEvents, ...opts.sourceTailEvents]);
}

function createActiveIssue(repo: string, issueId: string): void {
  const sourceDir = join(repo, ".gxpm", "issues", issueId);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "state.json"),
    JSON.stringify({ issueId, currentPhase: "triage" }),
  );
  writeEventsJsonl(sourceDir, issueId, [{ type: "issue.created" }]);
}
