import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { readArtifact, writeArtifact } from "../core/artifacts";

function readRaw(root: string, issueId: string, type: string) {
  return JSON.parse(
    readFileSync(
      join(root, ".gxpm", "issues", issueId, "artifacts", `${type}.json`),
      "utf8",
    ),
  );
}

describe("artifact provenance (GXPM-172)", () => {
  const originalSession = process.env.CODEX_COMPANION_SESSION_ID;

  afterEach(() => {
    if (originalSession === undefined) delete process.env.CODEX_COMPANION_SESSION_ID;
    else process.env.CODEX_COMPANION_SESSION_ID = originalSession;
  });

  test("stamps sessionId + host on every write", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-prov-host-"));
    process.env.CODEX_COMPANION_SESSION_ID = "abc123";
    createIssueState({ root, issueId: "GXPM-PROV-1" });

    writeArtifact({
      root,
      issueId: "GXPM-PROV-1",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });

    const raw = readRaw(root, "GXPM-PROV-1", "acceptance-contract");
    expect(raw.provenance).toBeDefined();
    expect(raw.provenance.sessionId).toBe("codex:abc123");
    expect(raw.provenance.host).toBe("codex");
  });

  test("omits worktreePath when no .gxpm-worktree-owner.json is present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-prov-noowner-"));
    process.env.CODEX_COMPANION_SESSION_ID = "noowner";
    createIssueState({ root, issueId: "GXPM-PROV-2" });

    writeArtifact({
      root,
      issueId: "GXPM-PROV-2",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });

    const raw = readRaw(root, "GXPM-PROV-2", "acceptance-contract");
    expect(raw.provenance.worktreePath).toBeUndefined();
  });

  test("reads worktreePath from .gxpm-worktree-owner.json when present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-prov-owner-"));
    process.env.CODEX_COMPANION_SESSION_ID = "with-owner";
    createIssueState({ root, issueId: "GXPM-PROV-3" });
    writeFileSync(
      join(root, ".gxpm-worktree-owner.json"),
      JSON.stringify({ workspacePath: "/expected/path", ownerIssueId: "GXPM-PROV-3" }),
    );

    writeArtifact({
      root,
      issueId: "GXPM-PROV-3",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });

    const raw = readRaw(root, "GXPM-PROV-3", "acceptance-contract");
    expect(raw.provenance.worktreePath).toBe("/expected/path");
  });

  test("omits baselineSha when root is not a git repo", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-prov-nogit-"));
    process.env.CODEX_COMPANION_SESSION_ID = "nogit";
    createIssueState({ root, issueId: "GXPM-PROV-4" });

    writeArtifact({
      root,
      issueId: "GXPM-PROV-4",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });

    const raw = readRaw(root, "GXPM-PROV-4", "acceptance-contract");
    expect(raw.provenance.baselineSha).toBeUndefined();
  });

  test("readArtifact tolerates legacy artifacts without provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-prov-legacy-"));
    process.env.CODEX_COMPANION_SESSION_ID = "legacy";
    createIssueState({ root, issueId: "GXPM-PROV-5" });

    writeArtifact({
      root,
      issueId: "GXPM-PROV-5",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });

    const artifactPath = join(
      root,
      ".gxpm",
      "issues",
      "GXPM-PROV-5",
      "artifacts",
      "acceptance-contract.json",
    );
    const stored = JSON.parse(readFileSync(artifactPath, "utf8"));
    delete stored.provenance;
    writeFileSync(artifactPath, `${JSON.stringify(stored, null, 2)}\n`);

    const result = readArtifact({
      root,
      issueId: "GXPM-PROV-5",
      type: "acceptance-contract",
    });
    expect(result.payload).toEqual({ criteria: [] });
  });
});
