import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "scripts", "gxpm.ts");

// Feature: gxpm issue status surfaces nextRequiredSkill from phase-handoff
//
// As an agent inspecting an issue mid-workflow
// I want `gxpm issue status` to surface the phase-handoff payload's
//   nextRequiredSkill + nextPhase
// So that I do not have to read the JSON artifact by hand to know
//   which skill is the next contractual gate.

function setupIssue(cwd: string, issueId: string, phase: string) {
  for (const dir of [".gxpm/issues", ".gxpm/local", ".gxpm/out-of-scope", ".gxpm/wiki"]) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }
  writeFileSync(
    join(cwd, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "optional", default: "ask" } }),
  );
  const issueDir = join(cwd, ".gxpm", "issues", issueId);
  mkdirSync(join(issueDir, "artifacts"), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(issueDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      issueType: "feature",
      title: "test",
      currentPhase: phase,
      createdAt: now,
      updatedAt: now,
      stateRoot: join(".gxpm", "issues", issueId),
      artifactRoot: join(".gxpm", "issues", issueId, "artifacts"),
      phaseHistory: [{ phase, enteredAt: now, fromPhase: null }],
    }),
  );
  return issueDir;
}

function writePhaseHandoff(issueDir: string, payload: Record<string, unknown>) {
  writeFileSync(
    join(issueDir, "artifacts", "phase-handoff.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId: payload.issueId ?? "GXPM-999",
      type: "phase-handoff",
      writtenAt: new Date().toISOString(),
      payload,
    }),
  );
}

describe("GXPM-206 · gxpm issue status surfaces nextRequiredSkill", () => {
  // Scenario (scn-01): phase-handoff artifact 存在 → status 输出含 nextRequiredSkill + nextPhase
  test("test_status_surfaces_next_required_skill_when_handoff_exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-206-scn01-"));
    const issueDir = setupIssue(cwd, "GXPM-999", "implement");
    writePhaseHandoff(issueDir, {
      fromPhase: "implement",
      nextPhase: "local-verify",
      nextRequiredArtifact: "local-verify",
      nextRequiredSkill: "gxpm-verify",
      completedAcceptance: [],
      nextPhaseMustRead: [],
      openBlockers: [],
      status: "ready",
    });

    const stdout = execSync(`bun ${CLI} issue status GXPM-999`, { cwd, encoding: "utf8" });
    expect(stdout).toContain("nextRequiredSkill: gxpm-verify");
    expect(stdout).toContain("nextPhase: local-verify");
  });

  // Scenario (scn-02): 无 phase-handoff → status 输出不含 nextRequiredSkill 行
  test("test_status_silent_when_no_handoff", () => {
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-206-scn02-"));
    setupIssue(cwd, "GXPM-998", "triage");

    const stdout = execSync(`bun ${CLI} issue status GXPM-998`, { cwd, encoding: "utf8" });
    expect(stdout).not.toContain("nextRequiredSkill");
    expect(stdout).not.toContain("nextPhase");
  });
});
