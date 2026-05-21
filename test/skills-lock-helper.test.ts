// Feature: Lock-hash logic lives in a single shared helper
//
// As a maintainer touching skills/ or skills-lock.json
// I want regenerateSkillsLock and validateSkillsLock to share the same
//   source-of-truth resolution (.tmpl preferred, SKILL.md fallback)
// So that future changes to the rule live in exactly one place — no more
//   ad-hoc bun -e snippets drifting from the validator. GXPM-156 REV-2.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  regenerateSkillsLock,
  validateSkillsLock,
} from "../scripts/skills-lock-check";

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface Fixture {
  root: string;
}

function setupFixture(skills: Array<{ name: string; md?: string; tmpl?: string }>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "gxpm-lock-helper-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  for (const s of skills) {
    mkdirSync(join(root, "skills", s.name), { recursive: true });
    if (s.md !== undefined) writeFileSync(join(root, "skills", s.name, "SKILL.md"), s.md);
    if (s.tmpl !== undefined) writeFileSync(join(root, "skills", s.name, "SKILL.md.tmpl"), s.tmpl);
  }
  return { root };
}

describe("skills-lock helper — shared regenerate + validate path", () => {
  const cleanups: string[] = [];
  afterEach(() => {
    for (const p of cleanups) rmSync(p, { recursive: true, force: true });
    cleanups.length = 0;
  });

  test("scn-01: regenerate then validate round trips clean", () => {
    const { root } = setupFixture([
      { name: "alpha", md: "# alpha\nstatic" },
      { name: "beta", md: "# beta\ngenerated", tmpl: "# beta tmpl source" },
    ]);
    cleanups.push(root);

    const result = regenerateSkillsLock({ root });
    expect(result.skillCount).toBe(2);
    expect(existsSync(join(root, "skills-lock.json"))).toBe(true);

    const errors = validateSkillsLock({ root });
    expect(errors).toEqual([]);
  });

  test("scn-02: when tmpl exists the tmpl content is hashed", () => {
    const tmplBody = "# tmpl source of truth";
    const mdBody = "# generated md (should be ignored)";
    const { root } = setupFixture([{ name: "gamma", md: mdBody, tmpl: tmplBody }]);
    cleanups.push(root);

    regenerateSkillsLock({ root });
    const lock = JSON.parse(readFileSync(join(root, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, string>;
    };
    expect(lock.skills["gamma"]).toBe(hashOf(tmplBody));
    expect(lock.skills["gamma"]).not.toBe(hashOf(mdBody));
  });

  test("scn-03: when tmpl is absent SKILL md is hashed as fallback", () => {
    const mdBody = "# delta only-md";
    const { root } = setupFixture([{ name: "delta", md: mdBody }]);
    cleanups.push(root);

    regenerateSkillsLock({ root });
    const lock = JSON.parse(readFileSync(join(root, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, string>;
    };
    expect(lock.skills["delta"]).toBe(hashOf(mdBody));
    expect(validateSkillsLock({ root })).toEqual([]);
  });

  test("scn-04-defense: regenerate throws when skills/ is missing instead of writing empty lock", () => {
    // Wrong --root used to silently clobber the lock to {skills:{}}. CodeRabbit P-major.
    const root = mkdtempSync(join(tmpdir(), "gxpm-lock-helper-no-skills-"));
    cleanups.push(root);
    // intentionally NO skills/ dir under root

    expect(() => regenerateSkillsLock({ root })).toThrow(/skills directory not found/);
    expect(existsSync(join(root, "skills-lock.json"))).toBe(false);
  });

  test("scn-05: adding a new skill folder auto enrolls into the lock on regenerate", () => {
    const { root } = setupFixture([{ name: "alpha", md: "# alpha" }]);
    cleanups.push(root);

    regenerateSkillsLock({ root });
    const firstLock = JSON.parse(readFileSync(join(root, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, string>;
    };
    expect(Object.keys(firstLock.skills)).toEqual(["alpha"]);

    // Add a brand-new skill folder and regenerate.
    mkdirSync(join(root, "skills", "omega"));
    writeFileSync(join(root, "skills", "omega", "SKILL.md"), "# omega new");

    regenerateSkillsLock({ root });
    const secondLock = JSON.parse(readFileSync(join(root, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, string>;
    };
    expect(Object.keys(secondLock.skills).sort()).toEqual(["alpha", "omega"]);
    expect(secondLock.skills["omega"]).toBe(hashOf("# omega new"));
    expect(validateSkillsLock({ root })).toEqual([]);
  });
});
