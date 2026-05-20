import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState, ISSUE_TYPES } from "../core/state";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-issue-type-ext-"));
}

function readState(root: string, id: string) {
  return JSON.parse(readFileSync(join(root, ".gxpm/issues", id, "state.json"), "utf-8"));
}

describe("GXPM-145: extended issueType enum", () => {
  test("ISSUE_TYPES includes the three new values", () => {
    expect(ISSUE_TYPES).toContain("documentation");
    expect(ISSUE_TYPES).toContain("postmortem");
    expect(ISSUE_TYPES).toContain("cross-repo-feedback");
  });

  test("scn-01: documentation issue defaults to rigor=lite", () => {
    const root = fresh();
    try {
      createIssueState({ root, issueId: "GXPM-D-1", issueType: "documentation" });
      const st = readState(root, "GXPM-D-1");
      expect(st.rigorLevel).toBe("lite");
      expect(st.issueType).toBe("documentation");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: postmortem issue defaults to rigor=standard", () => {
    const root = fresh();
    try {
      createIssueState({ root, issueId: "GXPM-P-1", issueType: "postmortem" });
      const st = readState(root, "GXPM-P-1");
      expect(st.rigorLevel).toBe("standard");
      expect(st.issueType).toBe("postmortem");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: cross-repo-feedback issue defaults to rigor=lite", () => {
    const root = fresh();
    try {
      createIssueState({ root, issueId: "GXPM-X-1", issueType: "cross-repo-feedback" });
      const st = readState(root, "GXPM-X-1");
      expect(st.rigorLevel).toBe("lite");
      expect(st.issueType).toBe("cross-repo-feedback");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("existing types still behave the same", () => {
    const root = fresh();
    try {
      createIssueState({ root, issueId: "GXPM-F-1", issueType: "feature" });
      expect(readState(root, "GXPM-F-1").rigorLevel).toBe("standard");
      createIssueState({ root, issueId: "GXPM-M-1", issueType: "meta" });
      expect(readState(root, "GXPM-M-1").rigorLevel).toBe("lite");
      createIssueState({ root, issueId: "GXPM-S-1", issueType: "spike" });
      expect(readState(root, "GXPM-S-1").rigorLevel).toBe("lite");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
