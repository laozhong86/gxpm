// Feature: Announce at start ritual covers every gxpm-* skill (no blind spots)
//
// As an agent invoking any gxpm-* skill
// I want every skill in the gxpm-* family (phase-aligned and non-aligned) to
//   require a public "Announce at start" commitment naming itself and its purpose
// So that the announce ritual covers the entire family and no skill silently
//   slips through. GXPM-161 covered the 8 phase-aligned skills; GXPM-175
//   extended coverage to the remaining 19 non-phase-aligned skills.

import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// White-list is DERIVED from the filesystem: every skills/gxpm-* folder
// except the meta `gxpm` entry itself. Adding a new gxpm-X skill folder
// automatically enrolls it into the announce contract — no test edit needed.
// GXPM-175 widened the contract from the 8 phase-aligned skills (GXPM-161)
// to every gxpm-* member.
const allGxpmSkills = readdirSync(resolve(REPO_ROOT, "skills"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gxpm-"))
  .map((entry) => entry.name)
  .sort();

const ANNOUNCE_PHRASE = "Announce at start";

describe("phase-aligned gxpm-* skills — Announce at start", () => {
  // The scenario number naming covers BOTH scn-01 (announce phrase + skill
  // name verbatim) AND scn-02 (white-list derived from PHASE_GATE_RULES at
  // runtime, not hardcoded — satisfied by the comprehension at file top).
  test("scn-01+02: every phase-aligned skill SKILL.md contains Announce phrase with its own name (white-list derived from PHASE_GATE_RULES)", () => {
    expect(allGxpmSkills.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const skill of allGxpmSkills) {
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
        `[${missing.length}/${allGxpmSkills.length}] phase-aligned skills failed Announce header check:\n` +
          missing.map((m) => `  - ${m}`).join("\n"),
      );
    }
  });

  test("scn-03: Announce line in .tmpl is identical in the generated SKILL.md (no drift)", () => {
    const drift: string[] = [];
    for (const skill of allGxpmSkills) {
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
