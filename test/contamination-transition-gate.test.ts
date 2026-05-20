import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-contam-gate-"));
}

function setupIssueAtPhase(root: string, phase: string, rigor: "lite" | "standard" | "full" = "lite") {
  const issueId = "GXPM-TEST-1";
  const issueType = rigor === "lite" ? "meta" : "feature";
  createIssueState({ root, issueId, issueType });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.currentPhase = phase;
  st.rigorLevel = rigor;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
  return issueId;
}

describe("GXPM-140: contamination gate on transition", () => {
  test("scn-01: clean artifact dir allows transition", () => {
    const root = freshRoot();
    try {
      const id = setupIssueAtPhase(root, "triage", "lite");
      writeArtifact({
        root, issueId: id, type: "acceptance-contract",
        payload: { criteria: ["x"], status: "ready" },
      });
      const after = transitionIssuePhase({ root, issueId: id, nextPhase: "plan" });
      expect(after.currentPhase).toBe("plan");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: contaminated file blocks transition", () => {
    const root = freshRoot();
    try {
      const id = setupIssueAtPhase(root, "triage", "lite");
      writeArtifact({
        root, issueId: id, type: "acceptance-contract",
        payload: { criteria: ["x"], status: "ready" },
      });
      const artifactDir = join(root, ".gxpm/issues", id, "artifacts");
      writeFileSync(
        join(artifactDir, "local-verify.contaminated-2026-05-19T14-00.json"),
        JSON.stringify({ payload: { changedFiles: ["wrong/file.ts"] } }),
      );
      expect(() => transitionIssuePhase({ root, issueId: id, nextPhase: "plan" })).toThrow(
        /contamination archive/,
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: error message lists each contaminated file", () => {
    const root = freshRoot();
    try {
      const id = setupIssueAtPhase(root, "triage", "lite");
      writeArtifact({
        root, issueId: id, type: "acceptance-contract",
        payload: { criteria: ["x"], status: "ready" },
      });
      const artifactDir = join(root, ".gxpm/issues", id, "artifacts");
      writeFileSync(join(artifactDir, "local-verify.contaminated-A.json"), "{}");
      writeFileSync(join(artifactDir, "verify-findings.contaminated-B.json"), "{}");
      let err: Error | undefined;
      try {
        transitionIssuePhase({ root, issueId: id, nextPhase: "plan" });
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("local-verify.contaminated-A.json");
      expect(err!.message).toContain("verify-findings.contaminated-B.json");
      expect(err!.message).toContain("phase rewind");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
