import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "../core/artifacts";
import { enterPhase, output, runCli } from "./helpers/workflow";

// Feature: GXPM-188 — gxpm doctor identity + gxpm issue handoff --to-next-phase
//
// Two active recovery commands for agents that lost their bearings or need
// to pass the baton at a phase boundary.

describe("gxpm doctor identity", () => {
  test("scn-01: outside an identified worktree, prints a friendly notice and exits 0", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-188-no-worktree-"));
    initRepo(repo);

    const result = runCli(repo, ["doctor", "identity"]);

    expect(result.exitCode).toBe(0);
    const text = output(result);
    expect(text.toLowerCase()).toContain("not inside an identified worktree");
  });

  test("scn-02: inside an identified worktree, prints ownerIssueId / currentPhase / requiredSkill", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-188-with-owner-"));
    initRepo(repo);
    enterPhase(repo, "GXPM-650", "plan");
    // Drop a .gxpm-worktree-owner.json in repo cwd so readWorktreeOwner returns one.
    writeFileSync(
      join(repo, ".gxpm-worktree-owner.json"),
      JSON.stringify({
        ownerIssueId: "GXPM-650",
        linkedIssues: ["GXPM-650"],
        createdAt: new Date().toISOString(),
        currentPhase: "plan",
        branchName: "gxpm-GXPM-650",
        workspacePath: repo,
      }),
    );

    const result = runCli(repo, ["doctor", "identity"]);
    expect(result.exitCode).toBe(0);
    const text = output(result);
    expect(text).toContain("ownerIssueId:    GXPM-650");
    expect(text).toContain("currentPhase:    plan");
    expect(text).toContain("requiredSkill:   gxpm-planning");
    expect(text).toContain("branchName:      gxpm-GXPM-650");
  });
});

describe("gxpm issue handoff --to-next-phase", () => {
  test("scn-03: produces phase-handoff artifact and emits phase.handoff.dumped event", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-188-handoff-"));
    initRepo(repo);
    enterPhase(repo, "GXPM-660", "plan");
    writeArtifact({
      root: repo,
      issueId: "GXPM-660",
      type: "acceptance-contract",
      payload: {
        criteria: [
          { id: "AC-1", description: "first done", status: "verified" },
          { id: "AC-2", description: "still pending", status: "pending" },
        ],
        status: "ready",
      },
    });

    const result = runCli(repo, ["issue", "handoff", "GXPM-660", "--to-next-phase"]);
    expect(result.exitCode).toBe(0);

    const artifact = JSON.parse(
      readFileSync(join(repo, ".gxpm/issues/GXPM-660/artifacts/phase-handoff.json"), "utf8"),
    );
    expect(artifact.type).toBe("phase-handoff");
    const payload = artifact.payload;
    expect(payload.fromPhase).toBe("plan");
    expect(payload.nextPhase).toBe("dispatch");
    expect(payload.completedAcceptance).toHaveLength(1);
    expect(payload.completedAcceptance[0].id).toBe("AC-1");
    expect(payload.openBlockers).toHaveLength(1);
    expect(payload.openBlockers[0].message).toContain("AC-2");
    expect(payload.nextPhaseMustRead).toContain("acceptance-contract");

    const events = readFileSync(join(repo, ".gxpm/issues/GXPM-660/events.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const dumped = events.filter((e) => e.type === "phase.handoff.dumped");
    expect(dumped.length).toBe(1);
    expect(dumped[0].payload.fromPhase).toBe("plan");
    expect(dumped[0].payload.nextPhase).toBe("dispatch");
  });

  test("scn-04: rejects without --to-next-phase flag", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-188-handoff-bad-"));
    initRepo(repo);
    enterPhase(repo, "GXPM-661", "plan");

    const result = runCli(repo, ["issue", "handoff", "GXPM-661"]);
    expect(result.exitCode).not.toBe(0);
    expect(output(result).toLowerCase()).toContain("to-next-phase");
  });
});

function initRepo(repo: string) {
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "t@t.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  writeFileSync(join(repo, "README.md"), "init");
  execSync("git add README.md", { cwd: repo });
  execSync('git commit -m "init"', { cwd: repo });
}
