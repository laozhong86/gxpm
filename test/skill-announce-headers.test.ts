// Feature: Phase-aligned gxpm-* skills announce themselves at start
//
// As an agent invoking a phase-aligned gxpm-* skill
// I want each such skill's SKILL.md to require a public "Announce at start"
//   commitment naming the skill and its phase-level purpose
// So that I cannot silently skip the skill — the ritual forces me to declare
//   my intent before any code or artifact write, complementing the CLI-level
//   requiredSkill contract from GXPM-156

import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_GATE_RULES } from "../core/phase-gates";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// White-list is DERIVED from PHASE_GATE_RULES at runtime, never hardcoded.
// Adding a new phase-aligned skill in core/phase-gates.ts automatically
// extends the contract enforced by this test (scn-02).
const phaseAlignedSkills = Array.from(
  new Set(
    PHASE_GATE_RULES.map((rule) => rule.requiredSkill).filter(
      (s): s is string => s !== null,
    ),
  ),
);

const ANNOUNCE_PHRASE = "Announce at start";

describe("phase-aligned gxpm-* skills — Announce at start", () => {
  test("scn-01: every phase-aligned skill SKILL.md contains Announce phrase with its own name", () => {
    expect(phaseAlignedSkills.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const skill of phaseAlignedSkills) {
      const skillMdPath = resolve(REPO_ROOT, "skills", skill, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        missing.push(`${skill}: SKILL.md does not exist at ${skillMdPath}`);
        continue;
      }
      const content = readFileSync(skillMdPath, "utf8");

      if (!content.includes(ANNOUNCE_PHRASE)) {
        missing.push(
          `${skill}: SKILL.md missing "${ANNOUNCE_PHRASE}" header. ` +
            `Source-of-truth: PHASE_GATE_RULES.requiredSkill in core/phase-gates.ts. ` +
            `Add a "**Announce at start:** \\"I'm using the ${skill} skill to <purpose>.\\"" ` +
            `line to skills/${skill}/SKILL.md.tmpl and run bun run gen:skill-docs.`,
        );
        continue;
      }
      if (!content.includes(`using the ${skill} skill`)) {
        missing.push(
          `${skill}: Announce line does not say "using the ${skill} skill". ` +
            `The agent must say the skill name verbatim out loud — generic ` +
            `phrasing defeats the ritual.`,
        );
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `[${missing.length}/${phaseAlignedSkills.length}] phase-aligned skills failed Announce header check:\n` +
          missing.map((m) => `  - ${m}`).join("\n"),
      );
    }
  });

  test("scn-03: Announce line in .tmpl is identical in the generated SKILL.md (no drift)", () => {
    const drift: string[] = [];
    for (const skill of phaseAlignedSkills) {
      const tmplPath = resolve(REPO_ROOT, "skills", skill, "SKILL.md.tmpl");
      const mdPath = resolve(REPO_ROOT, "skills", skill, "SKILL.md");
      if (!existsSync(tmplPath) || !existsSync(mdPath)) continue; // covered by scn-01

      const tmplLines = readFileSync(tmplPath, "utf8").split("\n");
      const mdContent = readFileSync(mdPath, "utf8");

      // Pull every line from the .tmpl that contains the announce phrase and
      // verify each one appears verbatim in the generated SKILL.md. This
      // catches: (a) someone hand-edits the SKILL.md without changing .tmpl,
      // (b) someone updates .tmpl without regenerating, (c) the renderer
      // accidentally drops/mangles the line.
      const announceLines = tmplLines.filter((l) => l.includes(ANNOUNCE_PHRASE));
      if (announceLines.length === 0) {
        drift.push(`${skill}: .tmpl has no Announce line — fix at the template, not the generated file.`);
        continue;
      }
      for (const line of announceLines) {
        if (!mdContent.includes(line)) {
          drift.push(
            `${skill}: Announce line present in .tmpl but missing from generated SKILL.md. ` +
              `Run \`bun run gen:skill-docs\`. Line: ${line.trim()}`,
          );
        }
      }
    }

    if (drift.length > 0) {
      throw new Error(
        `Template/generated SKILL.md drift on Announce line:\n` +
          drift.map((d) => `  - ${d}`).join("\n"),
      );
    }
  });
});
