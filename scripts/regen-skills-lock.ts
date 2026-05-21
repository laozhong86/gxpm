#!/usr/bin/env bun
/**
 * gxpm internal: regenerate skills-lock.json against the current working dir.
 *
 * Replaces the ad-hoc `bun -e` snippets that GXPM-156/161/170/175 each had to
 * carry. Delegates to scripts/skills-lock-check.ts so the
 * "tmpl preferred, SKILL.md fallback" rule lives in exactly one place.
 *
 * Usage:
 *   bun run scripts/regen-skills-lock.ts          # uses process.cwd()
 *   bun run scripts/regen-skills-lock.ts --root .  # explicit root
 */

import { regenerateSkillsLock } from "./skills-lock-check";

function parseRoot(argv: string[]): string | undefined {
  const idx = argv.indexOf("--root");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

if (import.meta.main) {
  const root = parseRoot(process.argv) ?? process.cwd();
  const result = regenerateSkillsLock({ root });
  console.log(`regenerated ${result.written}`);
  console.log(`skillCount: ${result.skillCount}`);
}
