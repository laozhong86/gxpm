import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState, nextVisiblePhase } from "../core/state";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-next-rigor-"));
}

function bootstrap(root: string, opts: { phase: string; rigor: "lite" | "standard" | "full" }) {
  const issueId = "GXPM-TEST-1";
  const issueType = opts.rigor === "lite" ? "meta" : "feature";
  createIssueState({ root, issueId, issueType });
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.currentPhase = opts.phase;
  state.rigorLevel = opts.rigor;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return issueId;
}

function gxpm(args: string[], cwd: string) {
  return spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd, encoding: "utf-8", env: { ...process.env, GXPM_TEST: "1" },
  });
}

describe("GXPM-150: issue next consumes rigorLevel", () => {
  test("nextVisiblePhase helper: lite plan → specify (skips dispatch)", () => {
    expect(nextVisiblePhase("plan", "lite")).toBe("specify");
  });
  test("nextVisiblePhase helper: standard self-review → ship (skips cleanup)", () => {
    expect(nextVisiblePhase("self-review", "standard")).toBe("ship");
  });
  test("nextVisiblePhase helper: full self-review → cleanup", () => {
    expect(nextVisiblePhase("self-review", "full")).toBe("cleanup");
  });
  test("nextVisiblePhase helper: lite ship → land (skips pr-check/verify/qa)", () => {
    expect(nextVisiblePhase("ship", "lite")).toBe("land");
  });

  test("scn-01: lite issue next from plan recommends specify, not dispatch", () => {
    const root = freshRoot();
    try {
      const id = bootstrap(root, { phase: "plan", rigor: "lite" });
      const r = gxpm(["issue", "next", id], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`gxpm issue transition ${id} specify`);
      expect(r.stdout).not.toContain(`gxpm issue transition ${id} dispatch`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: standard issue next from self-review recommends ship, not cleanup", () => {
    const root = freshRoot();
    try {
      const id = bootstrap(root, { phase: "self-review", rigor: "standard" });
      const r = gxpm(["issue", "next", id], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`gxpm issue transition ${id} ship`);
      expect(r.stdout).not.toContain(`gxpm issue transition ${id} cleanup`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-03: full issue next from self-review recommends cleanup", () => {
    const root = freshRoot();
    try {
      const id = bootstrap(root, { phase: "self-review", rigor: "full" });
      const r = gxpm(["issue", "next", id], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`gxpm issue transition ${id} cleanup`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-04: lite issue next from ship recommends land", () => {
    const root = freshRoot();
    try {
      const id = bootstrap(root, { phase: "ship", rigor: "lite" });
      const r = gxpm(["issue", "next", id], root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`gxpm issue transition ${id} land`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
