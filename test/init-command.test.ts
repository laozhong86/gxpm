import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gxpmBin = join(import.meta.dir, "..", "bin", "gxpm");

describe("gxpm init base branch resolution", () => {
  test("writes the only likely git base branch into repo config", () => {
    const root = initRepo("gxpm-init-develop-", "develop");

    const result = runInit(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Base branch: develop (git-branch)");
    expect(readConfig(root).worktree.baseBranch).toBe("develop");
  });

  test("uses AGENTS.md gxpm Config before branch heuristics", () => {
    const root = initRepo("gxpm-init-agents-", "main");
    writeFileSync(join(root, "AGENTS.md"), "## gxpm Config\n- worktree.baseBranch: trunk\n");

    const result = runInit(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Base branch: trunk (agents-md)");
    expect(readConfig(root).worktree.baseBranch).toBe("trunk");
  });

  test("uses CLAUDE.md gxpm Config when AGENTS.md does not define base branch", () => {
    const root = initRepo("gxpm-init-claude-", "main");
    writeFileSync(join(root, "CLAUDE.md"), "## gxpm Config\n- worktree.baseBranch: master\n");

    const result = runInit(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Base branch: master (claude-md)");
    expect(readConfig(root).worktree.baseBranch).toBe("master");
  });

  test("non-interactive init refuses ambiguous core branches without explicit base branch", () => {
    const root = initRepo("gxpm-init-ambiguous-", "main");
    git(root, "branch", "develop");

    const result = runInit(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Multiple likely base branches found: main, develop");
    expect(result.stderr.toString()).toContain("gxpm init --base-branch <branch>");
  });

  test("explicit --base-branch resolves ambiguous core branches", () => {
    const root = initRepo("gxpm-init-explicit-", "main");
    git(root, "branch", "develop");

    const result = runInit(root, "--base-branch", "develop");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Base branch: develop (option)");
    expect(readConfig(root).worktree.baseBranch).toBe("develop");
  });

  test("explicit --base-branch updates existing config without replacing other worktree settings", () => {
    const root = initRepo("gxpm-init-existing-config-", "main");
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ worktree: { enforcement: "required", default: "use", baseBranch: "main" } }, null, 2) + "\n",
    );

    const result = runInit(root, "--base-branch", "develop");
    const config = readConfig(root);

    expect(result.exitCode).toBe(0);
    expect(config.worktree.baseBranch).toBe("develop");
    expect(config.worktree.enforcement).toBe("required");
    expect(config.worktree.default).toBe("use");
  });
});

function runInit(root: string, ...extraArgs: string[]) {
  return Bun.spawnSync({
    cmd: [
      gxpmBin,
      "init",
      "--non-interactive",
      "--hosts",
      "none",
      "--skip-hooks",
      "--skip-skills",
      "--skip-codex-hooks",
      "--target",
      root,
      ...extraArgs,
    ],
    cwd: root,
    env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), "gxpm-init-home-")) },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function initRepo(prefix: string, branch: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(root, { recursive: true });
  git(root, "init", "-b", branch);
  git(root, "config", "user.email", "gxpm@example.test");
  git(root, "config", "user.name", "gxpm test");
  writeFileSync(join(root, "README.md"), "# test\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "init");
  return root;
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result;
}

function readConfig(root: string) {
  return JSON.parse(readFileSync(join(root, ".gxpm", "config.json"), "utf8")) as {
    worktree: { baseBranch: string; enforcement?: string; default?: string };
  };
}
