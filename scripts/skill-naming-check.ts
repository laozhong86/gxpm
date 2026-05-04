import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

export interface SkillNamingCheckOptions {
  root?: string;
}

export function validateSkillNaming(options: SkillNamingCheckOptions = {}): string[] {
  const root = options.root ?? DEFAULT_GXPM_ROOT;
  const skillsDir = join(root, "skills");
  const errors: string[] = [];

  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    return [`skills directory not found: ${skillsDir}`];
  }

  const entries = readdirSync(skillsDir);
  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (entry.startsWith(".")) continue;

    const isGxpmSkill = entry === "gxpm" || entry.startsWith("gxpm-");

    if (!isGxpmSkill) {
      console.warn(`[skill-naming] warning: skill "${entry}" does not use gxpm- prefix (recommended for gxpm official skills)`);
      continue;
    }

    const skillMdPath = join(entryPath, "SKILL.md");
    const skillTmplPath = join(entryPath, "SKILL.md.tmpl");

    let sourcePath: string | null = null;
    if (existsSync(skillTmplPath)) {
      sourcePath = skillTmplPath;
    } else if (existsSync(skillMdPath)) {
      sourcePath = skillMdPath;
    }

    if (!sourcePath) {
      errors.push(`skill "${entry}" missing SKILL.md or SKILL.md.tmpl`);
      continue;
    }

    const content = readFileSync(sourcePath, "utf8");
    if (!content.startsWith("---")) {
      errors.push(`skill "${entry}" frontmatter missing`);
      continue;
    }

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      errors.push(`skill "${entry}" frontmatter malformed`);
      continue;
    }

    const frontmatter = frontmatterMatch[1];
    if (!frontmatter.includes("name:")) {
      errors.push(`skill "${entry}" frontmatter missing name`);
    }
    if (!frontmatter.includes("description:")) {
      errors.push(`skill "${entry}" frontmatter missing description`);
    }
  }

  return errors;
}

if (import.meta.main) {
  const errors = validateSkillNaming();
  if (errors.length > 0) {
    console.error(errors.map((error) => `skill-naming: ${error}`).join("\n"));
    process.exit(1);
  }
  console.log("skill naming check passed");
}
