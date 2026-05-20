import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { checkGitignoreHygiene, checkBaseBranchResolution } from "../scripts/doctor";

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-doctor-hardening-"));
}

function initBareGitRepo(cwd: string) {
  execSync("git init -q", { cwd });
  execSync("git config user.email test@example.com", { cwd });
  execSync("git config user.name test", { cwd });
}

describe("GXPM-143: doctor init hardening", () => {
  test("scn-01: complete .gitignore passes", () => {
    const root = fresh();
    try {
      writeFileSync(
        join(root, ".gitignore"),
        ".gxpm/\nnode_modules\n.gxpm-worktree-owner.json\nISSUE_CONTEXT.md\n",
      );
      const r = checkGitignoreHygiene(root);
      expect(r.missing.length).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: missing entries surface as warnings", () => {
    const root = fresh();
    try {
      // Missing .gxpm-worktree-owner.json and ISSUE_CONTEXT.md
      writeFileSync(join(root, ".gitignore"), ".gxpm/\nnode_modules\n");
      const r = checkGitignoreHygiene(root);
      expect(r.missing).toContain(".gxpm-worktree-owner.json");
      expect(r.missing).toContain("ISSUE_CONTEXT.md");
      expect(r.missing).not.toContain(".gxpm/");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02b: completely missing .gitignore reports all required", () => {
    const root = fresh();
    try {
      const r = checkGitignoreHygiene(root);
      expect(r.missing.length).toBe(r.required.length);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: base-branch resolution reports source", () => {
    const root = fresh();
    try {
      initBareGitRepo(root);
      const r = checkBaseBranchResolution(root, root);
      // No origin remote in this bare repo → falls back to 'main'
      expect(r.value).toBe("main");
      expect(["config", "detected-origin-head", "fallback-main"]).toContain(r.source);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
