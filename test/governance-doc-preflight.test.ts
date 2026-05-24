import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGovernanceDocPreflight } from "../scripts/governance-doc-preflight";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initRepoWithCommitted(dir: string, agentsBody: string, claudeBody: string) {
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "test");
  writeFileSync(join(dir, "AGENTS.md"), agentsBody);
  writeFileSync(join(dir, "CLAUDE.md"), claudeBody);
  git(dir, "add", "AGENTS.md", "CLAUDE.md");
  git(dir, "commit", "-q", "-m", "init");
}

describe("governance-doc-preflight", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gxpm-preflight-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("passes when working tree is clean", () => {
    initRepoWithCommitted(
      dir,
      Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"),
      "thin claude\n",
    );
    const result = runGovernanceDocPreflight(dir);
    expect(result.ok).toBe(true);
  });

  test("passes when AGENTS.md is dirty but still within 150-line cap", () => {
    const initial = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    initRepoWithCommitted(dir, initial, "thin\n");
    writeFileSync(
      join(dir, "AGENTS.md"),
      initial + "\nadded one intentional line\n",
    );
    const result = runGovernanceDocPreflight(dir);
    expect(result.ok).toBe(true);
  });

  test("fails when AGENTS.md is dirty AND past 150-line cap, with remediation hint", () => {
    const initial = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    initRepoWithCommitted(dir, initial, "thin\n");
    const bloated = Array.from({ length: 200 }, (_, i) => `bloat ${i}`).join("\n");
    writeFileSync(join(dir, "AGENTS.md"), bloated);

    const result = runGovernanceDocPreflight(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("AGENTS.md");
    expect(result.message).toContain("cap 150");
    expect(result.message).toContain("git checkout -- AGENTS.md");
    expect(result.message).toContain("bun run nexus");
  });

  test("fails when CLAUDE.md is dirty AND past 80-line cap", () => {
    initRepoWithCommitted(
      dir,
      "AGENTS.md\n",
      "thin\n",
    );
    const bloated = Array.from({ length: 120 }, (_, i) => `bloat ${i}`).join("\n");
    writeFileSync(join(dir, "CLAUDE.md"), bloated);

    const result = runGovernanceDocPreflight(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("CLAUDE.md");
    expect(result.message).toContain("cap 80");
  });

  test("returns ok when git is unavailable (non-repo cwd)", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "gxpm-preflight-norepo-"));
    try {
      const result = runGovernanceDocPreflight(nonRepo);
      expect(result.ok).toBe(true);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
