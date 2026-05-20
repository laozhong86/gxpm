import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState, markIssueNextSeen, assertIssueNextSeen } from "../core/state";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-issue-next-enf-"));
}

function withSession<T>(sessionId: string, fn: () => T): T {
  // resolveSessionId reads CODEX_COMPANION_SESSION_ID and returns `codex:<id>`.
  const prev = process.env.CODEX_COMPANION_SESSION_ID;
  process.env.CODEX_COMPANION_SESSION_ID = sessionId;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
    else process.env.CODEX_COMPANION_SESSION_ID = prev;
  }
}

function simulateOwnershipChange(root: string, issueId: string, newSessionId: string) {
  // Match resolveSessionId prefixing: tests set CODEX_COMPANION_SESSION_ID, which
  // resolveSessionId returns as "codex:<id>". Mirror that prefix here.
  const fullSession = `codex:${newSessionId}`;
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.ownership = st.ownership ?? { currentSession: "codex:session-A", lastTouchedAt: new Date().toISOString(), history: [] };
  st.ownership.history = [
    { sessionId: "codex:session-A", firstTouch: new Date().toISOString(), lastTouch: new Date().toISOString() },
    { sessionId: fullSession, firstTouch: new Date().toISOString(), lastTouch: new Date().toISOString() },
  ];
  st.ownership.currentSession = fullSession;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
}

describe("GXPM-141: issue next enforcement", () => {
  test("scn-01: same-session create+write is unaffected", () => {
    const root = freshRoot();
    try {
      withSession("session-A", () => {
        const issueId = "GXPM-TEST-1";
        createIssueState({ root, issueId, issueType: "meta" });
        expect(() => assertIssueNextSeen({ root, issueId })).not.toThrow();
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: ownership change + no issue next consult → throws", () => {
    const root = freshRoot();
    try {
      withSession("session-A", () => {
        createIssueState({ root, issueId: "GXPM-TEST-1", issueType: "meta" });
      });
      simulateOwnershipChange(root, "GXPM-TEST-1", "session-B");
      withSession("session-B", () => {
        expect(() => assertIssueNextSeen({ root, issueId: "GXPM-TEST-1" })).toThrow(
          /has not consulted/,
        );
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: ownership change + issue next consult → permits", () => {
    const root = freshRoot();
    try {
      withSession("session-A", () => {
        createIssueState({ root, issueId: "GXPM-TEST-1", issueType: "meta" });
      });
      simulateOwnershipChange(root, "GXPM-TEST-1", "session-B");
      withSession("session-B", () => {
        markIssueNextSeen({ root, issueId: "GXPM-TEST-1" });
        expect(() => assertIssueNextSeen({ root, issueId: "GXPM-TEST-1" })).not.toThrow();
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-05: GXPM_BYPASS_ISSUE_NEXT_CHECK=1 bypasses the check", () => {
    const root = freshRoot();
    try {
      withSession("session-A", () => {
        createIssueState({ root, issueId: "GXPM-TEST-1", issueType: "meta" });
      });
      simulateOwnershipChange(root, "GXPM-TEST-1", "session-B");
      const prev = process.env.GXPM_BYPASS_ISSUE_NEXT_CHECK;
      process.env.GXPM_BYPASS_ISSUE_NEXT_CHECK = "1";
      try {
        withSession("session-B", () => {
          expect(() => assertIssueNextSeen({ root, issueId: "GXPM-TEST-1" })).not.toThrow();
        });
      } finally {
        if (prev === undefined) delete process.env.GXPM_BYPASS_ISSUE_NEXT_CHECK;
        else process.env.GXPM_BYPASS_ISSUE_NEXT_CHECK = prev;
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
