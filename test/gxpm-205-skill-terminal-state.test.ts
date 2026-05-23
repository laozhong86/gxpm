import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Feature: 8 个 phase-anchored skill 末端含 Terminal State 段 + frontmatter MUST description
//
// As an agent that just finished a gxpm phase
// I want every phase-anchored skill SKILL.md to declare an explicit Terminal
//   State section pointing at the next CLI command + next phase's skill
// So that I keep moving through the gxpm phase chain without manually
//   consulting `gxpm issue next` between phases.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PHASE_ANCHORED_SKILLS = [
  "gxpm-triage",
  "gxpm-planning",
  "gxpm-specifier",
  "gxpm-tdd",
  "gxpm-verify",
  "gxpm-review-changes",
  "gxpm-cleanup",
  "gxpm-browser",
];

describe("GXPM-205 · phase-anchored skill Terminal State + MUST description", () => {
  // Scenario (scn-01): 每个 phase-anchored skill 末端含 ## Terminal State 段
  test("test_each_phase_anchored_skill_declares_terminal_state", () => {
    const missing: string[] = [];
    for (const skill of PHASE_ANCHORED_SKILLS) {
      const path = resolve(REPO_ROOT, "skills", skill, "SKILL.md");
      if (!existsSync(path)) {
        missing.push(`${skill}: SKILL.md not found at ${path}`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      if (!/^##\s+Terminal State\b/m.test(content)) {
        missing.push(`${skill}: missing "## Terminal State" section`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Scenario (scn-02): 每个 phase-anchored skill description 含 MUST + phase 锚点
  test("test_each_phase_anchored_skill_description_uses_must", () => {
    const missing: string[] = [];
    for (const skill of PHASE_ANCHORED_SKILLS) {
      const path = resolve(REPO_ROOT, "skills", skill, "SKILL.md");
      if (!existsSync(path)) {
        missing.push(`${skill}: SKILL.md not found at ${path}`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        missing.push(`${skill}: missing frontmatter`);
        continue;
      }
      const fm = frontmatterMatch[1];
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      if (!descMatch) {
        missing.push(`${skill}: frontmatter missing description`);
        continue;
      }
      const desc = descMatch[1];
      if (!/\bMUST\b/.test(desc)) {
        missing.push(`${skill}: description does not say MUST: "${desc.slice(0, 80)}..."`);
      }
    }
    expect(missing).toEqual([]);
  });
});
