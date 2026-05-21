import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface SkillsLock {
  version: number;
  skills: Record<string, string>;
}

interface SkillsLockOptions {
  root?: string;
}

/**
 * Resolve the source-of-truth file for a skill: SKILL.md.tmpl when present
 * (templated skills), SKILL.md otherwise (static skills). Single owner of the
 * "tmpl preferred, SKILL.md fallback" rule used by both the validator and the
 * regenerator. GXPM-177 — extracted to retire the ad-hoc bun -e regenerators
 * that kept drifting (REV-2 of GXPM-156).
 */
function resolveSkillSource(skillsDir: string, skillName: string): string | null {
  const tmpl = resolve(skillsDir, skillName, "SKILL.md.tmpl");
  if (existsSync(tmpl)) return tmpl;
  const md = resolve(skillsDir, skillName, "SKILL.md");
  if (existsSync(md)) return md;
  return null;
}

function hashSkillSource(srcPath: string): string {
  return createHash("sha256").update(readFileSync(srcPath)).digest("hex");
}

export function validateSkillsLock(options: SkillsLockOptions = {}): string[] {
  const root = options.root ?? resolve(import.meta.dir, "..");
  const lockPath = resolve(root, "skills-lock.json");
  const skillsDir = resolve(root, "skills");

  if (!existsSync(lockPath)) {
    return ["skills-lock.json not found"];
  }

  let lock: SkillsLock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8")) as SkillsLock;
  } catch {
    return ["skills-lock.json is not valid JSON"];
  }

  if (lock.version !== 1) {
    return [`skills-lock.json version ${lock.version} is not supported`];
  }

  const errors: string[] = [];
  const expectedSkills = new Set(Object.keys(lock.skills));

  for (const [skillName, expectedHash] of Object.entries(lock.skills)) {
    const srcPath = resolveSkillSource(skillsDir, skillName);
    if (!srcPath) {
      errors.push(`skill ${skillName}: SKILL.md(.tmpl) missing`);
      continue;
    }
    const actualHash = hashSkillSource(srcPath);
    if (actualHash !== expectedHash) {
      errors.push(`skill ${skillName}: hash mismatch (expected ${expectedHash}, got ${actualHash})`);
    }
  }

  // Check for unlisted skills.
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true }) as unknown as { name: string; isDirectory: () => boolean }[];
    for (const entry of entries) {
      if (entry.isDirectory() && !expectedSkills.has(entry.name)) {
        if (resolveSkillSource(skillsDir, entry.name)) {
          errors.push(`skill ${entry.name}: not listed in skills-lock.json`);
        }
      }
    }
  }

  return errors;
}

/**
 * Regenerate skills-lock.json from the filesystem using the same
 * source-of-truth rule as `validateSkillsLock`. Sole owner of the
 * "tmpl preferred, SKILL.md fallback" computation. GXPM-177.
 */
export function regenerateSkillsLock(
  options: SkillsLockOptions = {},
): { skillCount: number; written: string } {
  const root = options.root ?? resolve(import.meta.dir, "..");
  const lockPath = resolve(root, "skills-lock.json");
  const skillsDir = resolve(root, "skills");

  const skills: Record<string, string> = {};
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true }) as unknown as {
      name: string;
      isDirectory: () => boolean;
    }[];
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (!entry.isDirectory()) continue;
      const srcPath = resolveSkillSource(skillsDir, entry.name);
      if (!srcPath) continue;
      skills[entry.name] = hashSkillSource(srcPath);
    }
  }

  const lock: SkillsLock = { version: 1, skills };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  return { skillCount: Object.keys(skills).length, written: lockPath };
}
