import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState } from "../core/state";
import { startAutopilotGrant, stopAutopilotGrant } from "../core/autopilot";
import { readBlockRecords } from "../core/autopilot-telemetry";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-autopilot-wiring-"));
}

function setupIssue(root: string, phase: string = "implement") {
  const issueId = "GXPM-T-1";
  createIssueState({ root, issueId, issueType: "feature" });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.currentPhase = phase;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
  return issueId;
}

describe("GXPM-164: stopAutopilotGrant wires telemetry", () => {
  test("scn-01: stop appends a block record with the given reason", () => {
    const root = fresh();
    try {
      const id = setupIssue(root, "implement");
      startAutopilotGrant({ root, issueId: id, profile: "full-delivery" });
      stopAutopilotGrant({ root, issueId: id, reason: "merge_conflict" });
      const records = readBlockRecords({ root, issueId: id });
      expect(records.length).toBe(1);
      expect(records[0].reason).toBe("merge_conflict");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: phase from issue state is captured", () => {
    const root = fresh();
    try {
      const id = setupIssue(root, "ship");
      startAutopilotGrant({ root, issueId: id, profile: "full-delivery" });
      stopAutopilotGrant({ root, issueId: id, reason: "policy_block" });
      const records = readBlockRecords({ root, issueId: id });
      expect(records[0].phase).toBe("ship");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: stop without active grant throws and writes nothing", () => {
    const root = fresh();
    try {
      const id = setupIssue(root, "implement");
      // do NOT start a grant
      expect(() => stopAutopilotGrant({ root, issueId: id, reason: "x" })).toThrow();
      const records = readBlockRecords({ root, issueId: id });
      expect(records.length).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
