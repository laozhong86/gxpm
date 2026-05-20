import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function fresh() {
  return mkdtempSync(join(tmpdir(), "gxpm-issue-title-"));
}

function gxpm(args: string[], cwd: string) {
  return spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd, encoding: "utf-8",
    env: { ...process.env, GXPM_BYPASS_ISSUE_NEXT_CHECK: "1" },
  });
}

describe("GXPM-148: issue create --title / --description", () => {
  test("scn-01: --title writes state.title", () => {
    const root = fresh();
    try {
      const r = gxpm(["issue", "create", "--auto-id", "--type", "meta", "--title", "My Hygiene Issue"], root);
      expect(r.status).toBe(0);
      const m = (r.stdout ?? "").match(/created (GXPM-\d+)/);
      expect(m).not.toBeNull();
      const id = m![1];
      const st = JSON.parse(readFileSync(join(root, ".gxpm/issues", id, "state.json"), "utf-8"));
      expect(st.title).toBe("My Hygiene Issue");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-02: status output includes title line", () => {
    const root = fresh();
    try {
      const c = gxpm(["issue", "create", "--auto-id", "--type", "meta", "--title", "Demo"], root);
      const id = ((c.stdout ?? "").match(/created (GXPM-\d+)/) ?? [])[1];
      const s = gxpm(["issue", "status", id], root);
      expect(s.status).toBe(0);
      expect(s.stdout).toContain("title: Demo");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-04: legacy issue without title shows [no title]", () => {
    const root = fresh();
    try {
      const c = gxpm(["issue", "create", "--auto-id", "--type", "meta"], root);
      const id = ((c.stdout ?? "").match(/created (GXPM-\d+)/) ?? [])[1];
      // Simulate legacy state.json by stripping title field
      const statePath = join(root, ".gxpm/issues", id, "state.json");
      const st = JSON.parse(readFileSync(statePath, "utf-8"));
      delete st.title;
      delete st.description;
      writeFileSync(statePath, JSON.stringify(st, null, 2));
      const s = gxpm(["issue", "status", id], root);
      expect(s.status).toBe(0);
      expect(s.stdout).toContain("title: [no title]");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("scn-bonus: --description is recorded", () => {
    const root = fresh();
    try {
      const r = gxpm(["issue", "create", "--auto-id", "--type", "meta", "--title", "T", "--description", "longer detail"], root);
      const id = ((r.stdout ?? "").match(/created (GXPM-\d+)/) ?? [])[1];
      const st = JSON.parse(readFileSync(join(root, ".gxpm/issues", id, "state.json"), "utf-8"));
      expect(st.description).toBe("longer detail");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
