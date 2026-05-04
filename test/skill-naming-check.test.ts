import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSkillNaming } from "../scripts/skill-naming-check";

describe("skill naming check", () => {
  test("passes for current repo with all gxpm- prefix skills", () => {
    const root = join(import.meta.dir, "..");
    const errors = validateSkillNaming({ root });
    expect(errors).toEqual([]);
  });

  test("warns on non-gxpm prefix skills but does not error", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skill-naming-warn-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir);
    mkdirSync(join(skillsDir, "custom-skill"));
    writeFileSync(
      join(skillsDir, "custom-skill", "SKILL.md"),
      "---\nname: custom-skill\ndescription: A custom skill\n---\n",
    );

    const consoleWarnSpy = [] as string[];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      consoleWarnSpy.push(args.join(" "));
    };

    const errors = validateSkillNaming({ root });

    console.warn = originalWarn;

    expect(errors).toEqual([]);
    expect(consoleWarnSpy.length).toBeGreaterThan(0);
    expect(consoleWarnSpy[0]).toContain("custom-skill");
    expect(consoleWarnSpy[0]).toContain("does not use gxpm- prefix");

    rmSync(root, { recursive: true });
  });

  test("errors on missing SKILL.md or SKILL.md.tmpl", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skill-naming-missing-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir);
    mkdirSync(join(skillsDir, "gxpm-missing-doc"));

    const errors = validateSkillNaming({ root });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("missing SKILL.md");

    rmSync(root, { recursive: true });
  });

  test("errors on missing frontmatter name or description", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skill-naming-fm-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir);
    mkdirSync(join(skillsDir, "gxpm-bad-fm"));
    writeFileSync(
      join(skillsDir, "gxpm-bad-fm", "SKILL.md"),
      "---\nname: gxpm-bad-fm\n---\n",
    );

    const errors = validateSkillNaming({ root });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("missing description");

    rmSync(root, { recursive: true });
  });

  test("errors on malformed frontmatter", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-skill-naming-malformed-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir);
    mkdirSync(join(skillsDir, "gxpm-malformed"));
    writeFileSync(
      join(skillsDir, "gxpm-malformed", "SKILL.md"),
      "---\nname: gxpm-malformed\n",
    );

    const errors = validateSkillNaming({ root });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("frontmatter malformed");

    rmSync(root, { recursive: true });
  });
});
