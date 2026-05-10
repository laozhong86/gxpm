import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, type DoctorReport } from "../scripts/doctor";
import { ALL_HOST_CONFIGS } from "../hosts";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "gxpm-doctor-home-"));
}
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gxpm-doctor-repo-"));
  execSync("git init -q", { cwd: dir });
  return dir;
}

describe("doctor", () => {
  test("reports skills missing when fakeHome empty", () => {
    const fakeHome = makeHome();
    const fakeRepo = makeRepo();
    const report = runDoctor({ home: fakeHome, cwd: fakeRepo });

    for (const host of ALL_HOST_CONFIGS) {
      const skill = report.skill.find((s) => s.host === host.name);
      expect(skill).toBeDefined();
      expect(skill?.installed).toBe(false);
    }
  });

  test("reports skills installed when SKILL.md exists at globalRoot", () => {
    const fakeHome = makeHome();
    for (const host of ALL_HOST_CONFIGS) {
      const target = join(fakeHome, host.globalRoot);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "SKILL.md"), "---\nname: gxpm\n---\nbody\n");
    }

    const fakeRepo = makeRepo();
    const report = runDoctor({ home: fakeHome, cwd: fakeRepo });

    for (const host of ALL_HOST_CONFIGS) {
      const skill = report.skill.find((s) => s.host === host.name);
      expect(skill?.installed).toBe(true);
    }
  });

  test("reports current repo status: git ok, hooks missing, no issues", () => {
    const fakeHome = makeHome();
    const fakeRepo = makeRepo();
    const report = runDoctor({ home: fakeHome, cwd: fakeRepo });

    expect(report.repo.isGitRepo).toBe(true);
    expect(report.repo.gxpmHooksInstalled).toBe(false);
    expect(report.repo.coreHooksPath).not.toBe(".githooks");
    expect(report.repo.gxpmDirExists).toBe(false);
    expect(report.repo.issueCount).toBe(0);
  });

  test("reports hooks installed when .githooks/gxpm-* exist + core.hooksPath set", () => {
    const fakeHome = makeHome();
    const fakeRepo = makeRepo();
    mkdirSync(join(fakeRepo, ".githooks"), { recursive: true });
    writeFileSync(join(fakeRepo, ".githooks", "gxpm-pre-commit"), "#!/bin/bash\n");
    writeFileSync(join(fakeRepo, ".githooks", "gxpm-commit-msg"), "#!/bin/bash\n");
    writeFileSync(join(fakeRepo, ".githooks", "gxpm-pre-push"), "#!/bin/bash\n");
    writeFileSync(join(fakeRepo, ".githooks", "gxpm-post-merge"), "#!/bin/bash\n");
    writeFileSync(join(fakeRepo, ".githooks", "gxpm-post-checkout"), "#!/bin/bash\n");
    execSync("git config core.hooksPath .githooks", { cwd: fakeRepo });

    const report = runDoctor({ home: fakeHome, cwd: fakeRepo });
    expect(report.repo.gxpmHooksInstalled).toBe(true);
    expect(report.repo.coreHooksPath).toBe(".githooks");
  });

  test("counts tracked issues from .gxpm/issues/", () => {
    const fakeHome = makeHome();
    const fakeRepo = makeRepo();

    const issuesDir = join(fakeRepo, ".gxpm", "issues");
    for (const id of ["GXPM-1", "GXPM-2", "GXPM-3"]) {
      mkdirSync(join(issuesDir, id), { recursive: true });
      writeFileSync(
        join(issuesDir, id, "state.json"),
        JSON.stringify({ schemaVersion: 1, issueId: id, currentPhase: "triage" }),
      );
    }

    const report = runDoctor({ home: fakeHome, cwd: fakeRepo });
    expect(report.repo.gxpmDirExists).toBe(true);
    expect(report.repo.issueCount).toBe(3);
  });

  test("non-git directory reports isGitRepo=false but doesn't crash", () => {
    const fakeHome = makeHome();
    const nonRepo = mkdtempSync(join(tmpdir(), "gxpm-doctor-nonrepo-"));
    const report = runDoctor({ home: fakeHome, cwd: nonRepo });
    expect(report.repo.isGitRepo).toBe(false);
  });
});
