// Feature: skill-structure-check CLI handles violations correctly (GXPM-162)
//
// Scenarios from .gxpm/issues/GXPM-162/artifacts/behavior-spec.json.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "scripts", "skill-structure-check.ts");

function runCli(root: string) {
  return spawnSync("bun", ["run", CLI, root], { encoding: "utf8" });
}

describe("scn-01: violations reported without TypeError", () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "gxpm-162-violations-"));
    mkdirSync(join(sandbox, "skills", "gxpm-broken"), { recursive: true });
    writeFileSync(
      join(sandbox, "skills", "gxpm-broken", "SKILL.md"),
      `---
name: gxpm-broken
description: Synthetic broken skill. Use when testing the CLI runner contract.
---

# broken

Body without any of the four required sections.
`,
      "utf8",
    );
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("exits 1, prints readable errors, no TypeError", () => {
    const result = runCli(sandbox);
    expect(result.status).toBe(1);
    const stderr = result.stderr || "";
    expect(stderr).toMatch(/MISSING|缺/);
    expect(stderr).toContain("gxpm-broken");
    // Regression guard: original bug printed "TypeError: ... is not a function"
    expect(stderr).not.toMatch(/TypeError/i);
    expect(stderr).not.toMatch(/is not a function/i);
  });
});

describe("scn-02: no violations exits 0", () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "gxpm-162-compliant-"));
    mkdirSync(join(sandbox, "skills", "gxpm-ok"), { recursive: true });
    writeFileSync(
      join(sandbox, "skills", "gxpm-ok", "SKILL.md"),
      `---
name: gxpm-ok
description: Synthetic compliant skill. Use when testing the CLI runner happy path.
---

# ok

## When to trigger

Trigger.

## 可操作流程

Steps.

## Red Flags

Anti-patterns.

## Verification

Checklist.
`,
      "utf8",
    );
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("exits 0 with success message on stdout", () => {
    const result = runCli(sandbox);
    expect(result.status).toBe(0);
    const stdout = result.stdout || "";
    expect(stdout).toMatch(/conform to the/);
  });
});
