import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-issue-link-"));
}

function gxpm(args: string[], cwd: string) {
  return spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GXPM_TEST: "1" },
  });
}

function readState(root: string, id: string) {
  return JSON.parse(readFileSync(join(root, ".gxpm/issues", id, "state.json"), "utf-8"));
}

function createIssue(root: string, type: "feature" | "meta" = "meta"): string {
  const r = gxpm(["issue", "create", "--auto-id", "--type", type], root);
  if (r.status !== 0) throw new Error(`create failed: ${r.stderr}`);
  const m = (r.stdout ?? "").match(/created (GXPM-\d+)/);
  if (!m) throw new Error(`could not parse created id from: ${r.stdout}`);
  return m[1];
}

describe("GXPM-159: gxpm issue link", () => {
  test("scn-01: --parent writes both sides", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const b = createIssue(root);
      const r = gxpm(["issue", "link", a, "--parent", b], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`linked ${a} --parent--> ${b}`);
      const stA = readState(root, a);
      const stB = readState(root, b);
      expect(stA.relations.some((x: any) => x.relation === "parent" && x.issueId === b)).toBe(true);
      expect(stB.relations.some((x: any) => x.relation === "child" && x.issueId === a)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-02: --related writes symmetrically", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const b = createIssue(root);
      const r = gxpm(["issue", "link", a, "--related", b], root);
      expect(r.status).toBe(0);
      const stA = readState(root, a);
      const stB = readState(root, b);
      expect(stA.relations.some((x: any) => x.relation === "related" && x.issueId === b)).toBe(true);
      expect(stB.relations.some((x: any) => x.relation === "related" && x.issueId === a)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-03: rejects self-link", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const r = gxpm(["issue", "link", a, "--parent", a], root);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("cannot link to self");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-04: rejects nonexistent target", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const r = gxpm(["issue", "link", a, "--parent", "GXPM-99999"], root);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("issue not found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-05: rejects duplicate relation", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const b = createIssue(root);
      const r1 = gxpm(["issue", "link", a, "--parent", b], root);
      expect(r1.status).toBe(0);
      const r2 = gxpm(["issue", "link", a, "--parent", b], root);
      expect(r2.status).not.toBe(0);
      expect(r2.stderr).toContain("relation already exists");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-06: status shows relations summary", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const b = createIssue(root);
      const c = createIssue(root);
      gxpm(["issue", "link", a, "--parent", b], root);
      gxpm(["issue", "link", a, "--related", c], root);
      const r = gxpm(["issue", "status", a], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`parent: ${b}`);
      expect(r.stdout).toContain(`related: ${c}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("scn-07: --parent and --related mutually exclusive", () => {
    const root = freshRoot();
    try {
      const a = createIssue(root);
      const b = createIssue(root);
      const r = gxpm(["issue", "link", a, "--parent", b, "--related", b], root);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("mutually exclusive");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
