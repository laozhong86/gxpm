import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface SkillsLock {
  version: number;
  skills: Record<string, string>;
}

export function validateSkillsLock(options: { root?: string } = {}): string[] {
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
    const skillPath = resolve(skillsDir, skillName, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(`skill ${skillName}: SKILL.md missing`);
      continue;
    }
    const content = readFileSync(skillPath);
    const actualHash = createHash("sha256").update(content).digest("hex");
    if (actualHash !== expectedHash) {
      errors.push(`skill ${skillName}: hash mismatch (expected ${expectedHash}, got ${actualHash})`);
    }
  }

  // Check for unlisted skills
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true }) as unknown as { name: string; isDirectory: () => boolean }[];
    for (const entry of entries) {
      if (entry.isDirectory() && !expectedSkills.has(entry.name)) {
        const skillPath = resolve(skillsDir, entry.name, "SKILL.md");
        if (existsSync(skillPath)) {
          errors.push(`skill ${entry.name}: not listed in skills-lock.json`);
        }
      }
    }
  }

  return errors;
}
