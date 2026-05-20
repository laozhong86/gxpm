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

// Regression: CodeRabbit P2 on PR #54 — when a templated skill's generated
// SKILL.md is missing (typical state right after editing .tmpl but before
// gen-skill-docs runs), runEval must not throw ENOENT; it must surface a
// readable validation error so scaffold-check can aggregate it.
describe("missing generated SKILL.md for templated skill (PR #54 regression)", () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "gxpm-eval-gate-missing-md-"));
    mkdirSync(join(sandbox, "skills", "gxpm-tmpl-only"), { recursive: true });
    // Only .tmpl exists — no generated SKILL.md
    const tmpl = `---
name: gxpm-tmpl-only
type: technique
description: Synthetic skill with only a tmpl file. Use when validating the missing-generated-md handling path.
---

# tmpl-only

## When to trigger

stub
`;
    writeFileSync(join(sandbox, "skills", "gxpm-tmpl-only", "SKILL.md.tmpl"), tmpl, "utf8");
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("validateSkillEval returns structured error, not throws", () => {
    let errors: string[] = [];
    expect(() => {
      errors = validateSkillEval({ root: sandbox, threshold: 90 });
    }).not.toThrow();

    expect(errors.length).toBeGreaterThan(0);
    const missingErr = errors.find((e) => e.includes("gxpm-tmpl-only"));
    expect(missingErr).toBeDefined();
    expect(missingErr).toMatch(/file-exists|missing/);
  });
});

// Regression: CodeRabbit on PR #54 — non-finite threshold must not silently
// disable the gate; comparison must use the raw percentage, not the rounded.
describe("threshold input validation (PR #54 regression)", () => {
  test("NaN threshold throws", () => {
    expect(() => validateSkillEval({ root: REPO_ROOT, threshold: Number.NaN })).toThrow(
      /threshold must be a finite number/,
    );
  });

  test("negative threshold throws", () => {
    expect(() => validateSkillEval({ root: REPO_ROOT, threshold: -1 })).toThrow(
      /threshold must be a finite number/,
    );
  });

  test("Infinity threshold throws", () => {
    expect(() => validateSkillEval({ root: REPO_ROOT, threshold: Infinity })).toThrow(
      /threshold must be a finite number/,
    );
  });
});
