// Feature: Skill quality gate at gxpm-check (GXPM-155)
//
// Behavior-spec scenarios from .gxpm/issues/GXPM-155/artifacts/behavior-spec.json.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSkillEval, DEFAULT_SKILL_EVAL_THRESHOLD } from "../scripts/eval";

const REPO_ROOT = join(import.meta.dir, "..");

// Scenario (scn-01): All skills compliant - check passes
test("scn-01: all 29 skills compliant - validateSkillEval returns no errors", () => {
  const errors = validateSkillEval({ root: REPO_ROOT });
  expect(errors).toEqual([]);
});

// Scenario (scn-02): Mutated skill below threshold - check fails
describe("scn-02: mutated skill below threshold", () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "gxpm-eval-gate-scn02-"));
    mkdirSync(join(sandbox, "skills", "gxpm-broken"), { recursive: true });
    // Missing required structure - will score below 90
    const broken = `---
name: gxpm-broken
type: technique
description: Synthetic broken skill used by skill-eval-gate test. Use when validating the eval threshold gate.
---

# broken

## 可操作流程

Body without the required English entry heading or Read Next.
`;
    writeFileSync(join(sandbox, "skills", "gxpm-broken", "SKILL.md"), broken, "utf8");
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("validateSkillEval surfaces failing skill name and failing check ids", () => {
    const errors = validateSkillEval({ root: sandbox, threshold: 90 });
    expect(errors.length).toBeGreaterThan(0);
    const brokenErr = errors.find((e) => e.includes("gxpm-broken"));
    expect(brokenErr).toBeDefined();
    expect(brokenErr).toMatch(/below threshold 90%/);
    expect(brokenErr).toMatch(/failing:/);
  });
});

// Scenario (scn-03): Threshold is configurable
describe("scn-03: threshold is configurable", () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "gxpm-eval-gate-scn03-"));
    mkdirSync(join(sandbox, "skills", "gxpm-midband"), { recursive: true });
    // Compliant on universal checks (technique type = max 60) so it scores 100%
    const midband = `---
name: gxpm-midband
type: technique
description: Synthetic skill used to validate threshold parameterization. Use when verifying the configurable threshold of skill-eval gate.
---

# midband

## When to trigger

Trigger heading exists.

## 可操作流程

Body.

## Read Next

- nowhere
`;
    writeFileSync(join(sandbox, "skills", "gxpm-midband", "SKILL.md"), midband, "utf8");
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("low threshold accepts a skill", () => {
    const errors = validateSkillEval({ root: sandbox, threshold: 50 });
    expect(errors.find((e) => e.includes("gxpm-midband"))).toBeUndefined();
  });

  test("impossibly high threshold rejects every skill", () => {
    // threshold 101 is unreachable, so even a 100% skill must produce an error
    const errors = validateSkillEval({ root: sandbox, threshold: 101 });
    expect(errors.find((e) => e.includes("gxpm-midband"))).toBeDefined();
  });
});

test("DEFAULT_SKILL_EVAL_THRESHOLD is 90", () => {
  expect(DEFAULT_SKILL_EVAL_THRESHOLD).toBe(90);
});
