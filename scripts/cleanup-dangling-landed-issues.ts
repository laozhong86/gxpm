import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const REINDEX_TYPES = new Set(["gitnexus.reindex.triggered", "gitnexus.reindex.failed"]);

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
}

// One-shot cleanup for source dirs left behind by cleanup land runs before
// GXPM-192. Safe by default (dry-run); only --execute actually deletes.
//
// A "dangling" issue is one whose source dir at .gxpm/issues/<id>/ AND archive
// copy at .gxpm/archive/<date>-<id>/ both exist. Deletion is only allowed when
// the archive's events.jsonl is a strict prefix of the source's events.jsonl
// AND the trailing events in source (beyond the archive snapshot) are limited
// to gitnexus.reindex.triggered or gitnexus.reindex.failed. Those trailing
// events are appended into the archive before the source dir is removed, so no
// telemetry is lost.

export interface DanglingCleanupResult {
  mode: "dry-run" | "execute";
  candidates: string[];
  deleted: string[];
  skipped: Array<{ issueId: string; reason: string }>;
}

export function runCleanupDanglingLandedCommand(input: {
  root: string;
  execute?: boolean;
}): DanglingCleanupResult {
  const issuesRoot = join(input.root, ".gxpm", "issues");
  const archiveRoot = join(input.root, ".gxpm", "archive");
  const mode: "dry-run" | "execute" = input.execute ? "execute" : "dry-run";

  if (!existsSync(issuesRoot) || !existsSync(archiveRoot)) {
    return { mode, candidates: [], deleted: [], skipped: [] };
  }

  const sourceIds = new Set(readdirSync(issuesRoot));
  const archiveIdsByEntry = new Map<string, string>();
  for (const entry of readdirSync(archiveRoot)) {
    const match = entry.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    if (!match) continue;
    const id = match[1];
    if (sourceIds.has(id)) archiveIdsByEntry.set(id, entry);
  }

  const candidates = [...archiveIdsByEntry.keys()].sort();

  if (mode === "dry-run") {
    return { mode, candidates, deleted: [], skipped: [] };
  }

  const deleted: string[] = [];
  const skipped: Array<{ issueId: string; reason: string }> = [];

  for (const issueId of candidates) {
    const sourceDir = join(issuesRoot, issueId);
    const archiveDir = join(archiveRoot, archiveIdsByEntry.get(issueId)!);
    const archiveLines = readLines(join(archiveDir, "events.jsonl"));
    const sourceLines = readLines(join(sourceDir, "events.jsonl"));

    // Archive must contain cleanup.executed somewhere.
    const archiveHasExecuted = archiveLines.some((line) => {
      try {
        return (JSON.parse(line) as { type: string }).type === "cleanup.executed";
      } catch {
        return false;
      }
    });
    if (!archiveHasExecuted) {
      skipped.push({ issueId, reason: "missing cleanup.executed in archive" });
      continue;
    }

    // Archive must be a strict prefix of source.
    if (archiveLines.length > sourceLines.length) {
      skipped.push({ issueId, reason: "archive longer than source (not a prefix)" });
      continue;
    }
    let prefixOk = true;
    for (let i = 0; i < archiveLines.length; i++) {
      if (archiveLines[i] !== sourceLines[i]) {
        prefixOk = false;
        break;
      }
    }
    if (!prefixOk) {
      skipped.push({ issueId, reason: "archive is not a strict prefix of source" });
      continue;
    }

    // Trailing source events must all be reindex telemetry.
    const tail = sourceLines.slice(archiveLines.length);
    const tailNonReindex = tail.find((line) => {
      try {
        return !REINDEX_TYPES.has((JSON.parse(line) as { type: string }).type);
      } catch {
        return true;
      }
    });
    if (tailNonReindex) {
      skipped.push({ issueId, reason: "non-reindex events in source tail" });
      continue;
    }

    // Backfill the tail into archive, then delete source.
    if (tail.length > 0) {
      appendFileSync(join(archiveDir, "events.jsonl"), `${tail.join("\n")}\n`);
    }
    rmSync(sourceDir, { recursive: true, force: true });
    deleted.push(issueId);
  }

  return { mode, candidates, deleted, skipped };
}

function printSummary(result: DanglingCleanupResult): void {
  const header = result.mode === "dry-run" ? "DRY-RUN" : "EXECUTE";
  console.log(`[${header}] candidates: ${result.candidates.length}`);
  for (const id of result.candidates) console.log(`  candidate: ${id}`);
  if (result.deleted.length > 0) {
    console.log(`deleted: ${result.deleted.length}`);
    for (const id of result.deleted) console.log(`  deleted: ${id}`);
  }
  if (result.skipped.length > 0) {
    console.log(`skipped: ${result.skipped.length}`);
    for (const { issueId, reason } of result.skipped) {
      console.log(`  skipped: ${issueId}  reason: ${reason}`);
    }
  }
  if (result.mode === "dry-run" && result.candidates.length > 0) {
    console.log("\nRe-run with --execute to actually clean these up.");
  }
}

if (import.meta.main) {
  const execute = process.argv.includes("--execute");
  const result = runCleanupDanglingLandedCommand({ root: process.cwd(), execute });
  printSummary(result);
}
