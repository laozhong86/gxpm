import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluatePrePush } from "../core/gate";
import { writeArtifact, readArtifact } from "../core/artifacts";
import { createIssueState } from "../core/state";
import { execSync } from "node:child_process";

function setupRepo(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execSync("git init", { cwd: root });
  execSync("git config user.email 'test@test.com'", { cwd: root });
  execSync("git config user.name 'Test'", { cwd: root });
  writeFileSync(join(root, "README.md"), "# test\n");
  execSync("git add .", { cwd: root });
  execSync("git commit -m 'init'", { cwd: root });
  return root;
}

describe("artifact contamination detection", () => {
  test("contaminated file blocks gate (scn-02)", () => {
    const root = setupRepo("gxpm-contaminated-");
    createIssueState({ root, issueId: "GXPM-AC-01" });
    writeArtifact({ root, issueId: "GXPM-AC-01", type: "local-verify", payload: { changedFiles: ["a.ts"], status: "draft" } });

    // No contamination yet — gate should pass
    const v1 = evaluatePrePush(
      { issueId: "GXPM-AC-01", currentPhase: "implement" } as any,
      (_id, _t) => true,
      {},
      root,
    );
    expect(v1.allowed).toBe(true);

    // Create .contaminated file
    const artifactDir = join(root, ".gxpm", "issues", "GXPM-AC-01", "artifacts");
    writeFileSync(join(artifactDir, ".contaminated-2026-01-01.json"), "{}");

    const v2 = evaluatePrePush(
      { issueId: "GXPM-AC-01", currentPhase: "implement" } as any,
      (_id, _t) => true,
      {},
      root,
    );
    expect(v2.allowed).toBe(false);
    expect(v2.code).toBe("contamination-detected");
  });

  test("empty changedFiles blocks gate (scn-03)", () => {
    const root = setupRepo("gxpm-empty-changed-");
    createIssueState({ root, issueId: "GXPM-AC-02" });
    writeArtifact({ root, issueId: "GXPM-AC-02", type: "local-verify", payload: { changedFiles: [], status: "draft" } });

    const v = evaluatePrePush(
      { issueId: "GXPM-AC-02", currentPhase: "implement" } as any,
      (_id, _t) => true,
      {},
      root,
    );
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("missing-changed-files");
  });

  test("local-verify changedFiles mismatch triggers warning (scn-01)", () => {
    const root = setupRepo("gxpm-scope-drift-");
    createIssueState({ root, issueId: "GXPM-AC-03" });

    // Create a worktree directory for the issue
    const worktreeDir = join(root, ".gxpm", "worktrees", "gxpm-GXPM-AC-03");
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(join(worktreeDir, "real.ts"), "// real change\n");
    execSync("git add real.ts", { cwd: worktreeDir });

    writeArtifact({
      root,
      issueId: "GXPM-AC-03",
      type: "local-verify",
      payload: { changedFiles: ["real.ts", "fake.ts"], status: "draft", verificationLog: [] },
    });

    const artifact = readArtifact({ root, issueId: "GXPM-AC-03", type: "local-verify" });
    const log = (artifact.payload as any).verificationLog ?? [];
    expect(log.some((entry: string) => entry.includes("SCOPE_DRIFT_WARNING") && entry.includes("fake.ts"))).toBe(true);
  });
});
