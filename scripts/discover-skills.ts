import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface SkillTemplate {
  tmpl: string;
  output: string;
  /** Skill name derived from directory path, e.g. "gxpm" or "graph/debug-issue" */
  name: string;
}

const SKIP_DIRS = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".generated",
  ".git",
  ".gstack",
  ".omc",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export function discoverTemplates(root = process.cwd()): SkillTemplate[] {
  const templates: SkillTemplate[] = [];
  const skillsDir = join(root, "skills");

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "SKILL.md.tmpl") {
        const tmpl = normalizePath(relative(root, fullPath));
        const skillPath = tmpl.replace(/\.tmpl$/, "");
        const name = skillPath.replace(/^skills\//, "").replace(/\/SKILL\.md$/, "");
        templates.push({
          tmpl,
          output: skillPath,
          name,
        });
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        // Skip generated artifacts that have a corresponding .tmpl source
        const tmplPath = fullPath + ".tmpl";
        if (existsSync(tmplPath)) {
          continue;
        }
        const tmpl = normalizePath(relative(root, fullPath));
        const name = tmpl.replace(/^skills\//, "").replace(/\/SKILL\.md$/, "");
        templates.push({
          tmpl,
          output: tmpl,
          name,
        });
      }
    }
  }

  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    walk(skillsDir);
  }

  return templates.sort((a, b) => a.tmpl.localeCompare(b.tmpl));
}

function normalizePath(path: string) {
  return path.split("\\").join("/");
}
