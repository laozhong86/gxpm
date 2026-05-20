/**
 * GXPM-147: autopilot block telemetry helpers.
 *
 * Persists hard-stop block records to .gxpm/issues/<id>/memory/autopilot-blocks.jsonl
 * so future analysis can identify recurring failure modes. Pure persistence
 * + aggregation; the autopilot.ts hook that calls into this module is
 * intentional follow-up scope.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface BlockRecord {
  /** ISO timestamp the block fired at. */
  at: string;
  /** Short human-readable reason hash key (e.g. 'merge_conflict', 'tests_failed'). */
  reason: string;
  /** Phase the issue was in when the block fired. */
  phase: string;
  /** Last command attempted before the block (optional). */
  lastCommand?: string;
  /** Short stderr / output excerpt (≤500 chars recommended). */
  detail?: string;
}

function memoryDir(root: string, issueId: string): string {
  return join(root, ".gxpm", "issues", issueId, "memory");
}

function blockFile(root: string, issueId: string): string {
  return join(memoryDir(root, issueId), "autopilot-blocks.jsonl");
}

/**
 * Append a block record. Creates the memory directory if missing.
 */
export function appendBlockRecord(input: {
  root: string;
  issueId: string;
  record: BlockRecord;
}): void {
  const path = blockFile(input.root, input.issueId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(input.record)}\n`);
}

/**
 * Read all block records for an issue. Returns [] if the file or memory
 * directory is missing — never throws on absence.
 */
export function readBlockRecords(input: { root: string; issueId: string }): BlockRecord[] {
  const path = blockFile(input.root, input.issueId);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  const out: BlockRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as BlockRecord);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export interface TopReason {
  reason: string;
  count: number;
}

/**
 * Group records by reason and return the top-N most frequent. Ties broken
 * by first-seen order. n=0 returns all.
 */
export function topBlockReasons(records: BlockRecord[], n: number = 3): TopReason[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const r of records) {
    if (!counts.has(r.reason)) order.push(r.reason);
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  const sorted = order
    .map((reason) => ({ reason, count: counts.get(reason) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return n > 0 ? sorted.slice(0, n) : sorted;
}
