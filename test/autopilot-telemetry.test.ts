import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendBlockRecord,
  readBlockRecords,
  topBlockReasons,
  type BlockRecord,
} from "../core/autopilot-telemetry";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-autopilot-telemetry-"));
}

describe("GXPM-147: autopilot block telemetry", () => {
  test("scn-01: append + read roundtrip", () => {
    const root = fresh();
    try {
      const rec: BlockRecord = {
        at: "2026-05-20T16:00:00Z",
        reason: "merge_conflict",
        phase: "ship",
        lastCommand: "git merge",
        detail: "CONFLICT: file.ts",
      };
      appendBlockRecord({ root, issueId: "GXPM-T-1", record: rec });
      const out = readBlockRecords({ root, issueId: "GXPM-T-1" });
      expect(out.length).toBe(1);
      expect(out[0].reason).toBe("merge_conflict");
      expect(out[0].lastCommand).toBe("git merge");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: topBlockReasons groups by reason and sorts by count", () => {
    const records: BlockRecord[] = [
      { at: "1", reason: "A", phase: "implement" },
      { at: "2", reason: "A", phase: "implement" },
      { at: "3", reason: "B", phase: "ship" },
      { at: "4", reason: "A", phase: "implement" },
      { at: "5", reason: "C", phase: "verify" },
      { at: "6", reason: "B", phase: "ship" },
    ];
    const top = topBlockReasons(records, 5);
    expect(top[0]).toEqual({ reason: "A", count: 3 });
    expect(top[1]).toEqual({ reason: "B", count: 2 });
    expect(top[2]).toEqual({ reason: "C", count: 1 });
  });

  test("scn-03: read returns [] when memory dir is missing", () => {
    const root = fresh();
    try {
      const out = readBlockRecords({ root, issueId: "GXPM-MISSING" });
      expect(out).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bonus: malformed lines are skipped", () => {
    const root = fresh();
    try {
      const issueId = "GXPM-T-2";
      const memDir = join(root, ".gxpm/issues", issueId, "memory");
      mkdirSync(memDir, { recursive: true });
      const file = join(memDir, "autopilot-blocks.jsonl");
      require("node:fs").writeFileSync(
        file,
        '{"at":"x","reason":"ok","phase":"p"}\nnot-json-line\n{"at":"y","reason":"ok2","phase":"q"}\n',
      );
      const out = readBlockRecords({ root, issueId });
      expect(out.length).toBe(2);
      expect(out.map((r) => r.reason)).toEqual(["ok", "ok2"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bonus: topBlockReasons with n=0 returns all", () => {
    const records: BlockRecord[] = [
      { at: "1", reason: "A", phase: "x" },
      { at: "2", reason: "B", phase: "x" },
      { at: "3", reason: "C", phase: "x" },
      { at: "4", reason: "D", phase: "x" },
    ];
    expect(topBlockReasons(records, 0).length).toBe(4);
  });
});
