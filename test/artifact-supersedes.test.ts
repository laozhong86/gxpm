import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";

function plantContaminatedArchive(root: string, issueId: string, filename: string) {
  const dir = join(root, ".gxpm", "issues", issueId, "artifacts");
  writeFileSync(
    join(dir, filename),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "local-verify",
      writtenAt: "2026-05-19T00:00:00.000Z",
      payload: {},
    }),
  );
}

describe("artifact supersedes field (GXPM-176)", () => {
  test("contamination gate blocks when no supersedes declared", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sup-block-"));
    createIssueState({ root, issueId: "GXPM-SUP-1" });
    writeArtifact({
      root,
      issueId: "GXPM-SUP-1",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });
    plantContaminatedArchive(root, "GXPM-SUP-1", "local-verify.contaminated-2026-05-19.json");

    expect(() =>
      transitionIssuePhase({
        root,
        issueId: "GXPM-SUP-1",
        nextPhase: "plan",
        actor: "test",
      }),
    ).toThrow(/contamination archive/);
  });

  test("contamination gate releases when every archive is covered by supersedes", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sup-cover-"));
    createIssueState({ root, issueId: "GXPM-SUP-2" });
    writeArtifact({
      root,
      issueId: "GXPM-SUP-2",
      type: "acceptance-contract",
      payload: { criteria: [] },
      supersedes: [
        {
          contaminatedArchive: "local-verify.contaminated-2026-05-19.json",
          reason: "manual rebaseline after worktree owner change",
          supersededAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    });
    plantContaminatedArchive(root, "GXPM-SUP-2", "local-verify.contaminated-2026-05-19.json");

    expect(() =>
      transitionIssuePhase({
        root,
        issueId: "GXPM-SUP-2",
        nextPhase: "plan",
        actor: "test",
      }),
    ).not.toThrow();
  });

  test("partial coverage still blocks, listing only uncovered archives", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sup-partial-"));
    createIssueState({ root, issueId: "GXPM-SUP-3" });
    writeArtifact({
      root,
      issueId: "GXPM-SUP-3",
      type: "acceptance-contract",
      payload: { criteria: [] },
      supersedes: [
        {
          contaminatedArchive: "local-verify.contaminated-A.json",
          reason: "covered",
          supersededAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    });
    plantContaminatedArchive(root, "GXPM-SUP-3", "local-verify.contaminated-A.json");
    plantContaminatedArchive(root, "GXPM-SUP-3", "local-verify.contaminated-B.json");

    try {
      transitionIssuePhase({
        root,
        issueId: "GXPM-SUP-3",
        nextPhase: "plan",
        actor: "test",
      });
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("local-verify.contaminated-B.json");
      expect(msg).not.toContain("local-verify.contaminated-A.json");
    }
  });

  test("legacy artifact without supersedes never falsely covers anything", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sup-legacy-"));
    createIssueState({ root, issueId: "GXPM-SUP-4" });
    // Legacy: no supersedes field
    writeArtifact({
      root,
      issueId: "GXPM-SUP-4",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });
    plantContaminatedArchive(root, "GXPM-SUP-4", "local-verify.contaminated-legacy.json");

    expect(() =>
      transitionIssuePhase({
        root,
        issueId: "GXPM-SUP-4",
        nextPhase: "plan",
        actor: "test",
      }),
    ).toThrow(/contamination archive/);
  });
});
