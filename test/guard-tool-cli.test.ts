import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState } from "../core/state";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-guard-cli-"));
}

function setupIssue(root: string, issueId: string, phase: string) {
  createIssueState({ root, issueId, issueType: "feature" });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const st = JSON.parse(readFileSync(statePath, "utf-8"));
  st.currentPhase = phase;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
}

function gxpm(args: string[], cwd: string) {
  return spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd, encoding: "utf-8",
    env: { ...process.env, GXPM_BYPASS_ISSUE_NEXT_CHECK: "1" },
  });
}

describe("GXPM-167: gxpm guard tool CLI", () => {
  test("scn-01: allowed tool exits 0", () => {
    const root = fresh();
    try {
      setupIssue(root, "GXPM-T-1", "implement");
      const r = gxpm(["guard", "tool", "git push --force", "--issue", "GXPM-T-1"], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("allow");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: forbidden tool exits 1", () => {
    const root = fresh();
    try {
      setupIssue(root, "GXPM-T-1", "self-review");
      const r = gxpm(["guard", "tool", "git push --force origin main", "--issue", "GXPM-T-1"], root);
      expect(r.status).toBe(1);
      expect(r.stdout.toLowerCase()).toContain("deny");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: --json output has expected shape", () => {
    const root = fresh();
    try {
      setupIssue(root, "GXPM-T-1", "self-review");
      const r = gxpm(["guard", "tool", "gxpm cleanup land GXPM-X", "--issue", "GXPM-T-1", "--json"], root);
      expect(r.status).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.allow).toBe(false);
      expect(parsed.decision).toBe("block");
      expect(typeof parsed.reason).toBe("string");
      expect(parsed.issueId).toBe("GXPM-T-1");
      expect(parsed.phase).toBe("self-review");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-04: --issue missing → defaults to allow with reason", () => {
    const root = fresh();
    try {
      const r = gxpm(["guard", "tool", "git push --force", "--json"], root);
      // cwd has no .gxpm-worktree-owner.json — default-allow
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.allow).toBe(true);
      expect(parsed.reason).toContain("no issue context");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bonus: --help prints USAGE", () => {
    const r = gxpm(["guard", "--help"], "/tmp");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gxpm guard tool");
  });
});
