import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installScript = resolve(import.meta.dir, "..", "scripts", "install-hooks.ts");

function bunRun(args: string[], cwd: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", installScript, ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("install-hooks", () => {
  test("installs gxpm hook files into target repo's .githooks/", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-target-"));
    execSync("git init -q", { cwd: repo });

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    expect(existsSync(join(repo, ".githooks", "gxpm-pre-commit"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-commit-msg"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-pre-push"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-post-merge"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-post-checkout"))).toBe(true);
    const preCommit = readFileSync(join(repo, ".githooks", "gxpm-pre-commit"), "utf8");
    expect(preCommit).toContain("gate branch-policy");
    const postCheckout = readFileSync(join(repo, ".githooks", "gxpm-post-checkout"), "utf8");
    expect(postCheckout).toContain("gate branch-policy");
    const postMerge = readFileSync(join(repo, ".githooks", "gxpm-post-merge"), "utf8");
    expect(postMerge).toContain('gxpm gate post-merge "$issue_id" || true');
    expect(postMerge).toContain("post-merge-reconcile");
    expect(postMerge).toContain("post-merge-error.log");
  });

  test("sets git core.hooksPath to .githooks", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-hookspath-"));
    execSync("git init -q", { cwd: repo });

    bunRun(["--target", repo], repo);

    const hooksPath = execSync("git config core.hooksPath", { cwd: repo }).toString().trim();
    expect(hooksPath).toBe(".githooks");
  });

  test("does not overwrite existing .githooks/pre-commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-noclobber-"));
    execSync("git init -q", { cwd: repo });
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    writeFileSync(join(repo, ".githooks", "pre-commit"), "#existing\n");

    bunRun(["--target", repo], repo);

    const content = readFileSync(join(repo, ".githooks", "pre-commit"), "utf8");
    expect(content).toContain("#existing");
  });

  test("fails when target is not a git repo", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "gxpm-install-not-repo-"));
    const r = bunRun(["--target", nonRepo], nonRepo);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("Not a git repository");
  });

  test("creates top-level dispatcher hooks when none exist", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-dispatcher-"));
    execSync("git init -q", { cwd: repo });

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    expect(existsSync(join(repo, ".githooks", "pre-commit"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "commit-msg"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "pre-push"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "post-merge"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "post-checkout"))).toBe(true);

    const preCommit = readFileSync(join(repo, ".githooks", "pre-commit"), "utf8");
    expect(preCommit).toContain("gxpm-pre-commit");
    const postCheckout = readFileSync(join(repo, ".githooks", "post-checkout"), "utf8");
    expect(postCheckout).toContain("gxpm-post-checkout");
  });
});
