import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface SkillTemplate {
  tmpl: string;
  output: string;
  /** Skill name derived from directory path, e.g. "gxpm" or "gxpm-debug-issue" */
  name: string;
  /** Relative paths to reference markdown files under references/ */
  references?: string[];
  /** Relative paths to script files under scripts/ */
  scripts?: string[];
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
        const skillDir = dirname(fullPath);
        templates.push({
          tmpl,
          output: skillPath,
          name,
          references: discoverReferences(root, skillDir),
          scripts: discoverScripts(root, skillDir),
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
        const skillDir = dirname(fullPath);
        templates.push({
          tmpl,
          output: tmpl,
          name,
          references: discoverReferences(root, skillDir),
          scripts: discoverScripts(root, skillDir),
        });
      }
    }
  }

  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    walk(skillsDir);
  }

  return templates.sort((a, b) => a.tmpl.localeCompare(b.tmpl));
}

function discoverReferences(root: string, skillDir: string): string[] | undefined {
  const refsDir = join(skillDir, "references");
  if (!existsSync(refsDir) || !statSync(refsDir).isDirectory()) {
    return undefined;
  }
  const refs: string[] = [];
  for (const entry of readdirSync(refsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      refs.push(normalizePath(relative(root, join(refsDir, entry.name))));
    }
  }
  return refs.length > 0 ? refs.sort() : undefined;
}

function discoverScripts(root: string, skillDir: string): string[] | undefined {
  const scriptsDir = join(skillDir, "scripts");
  if (!existsSync(scriptsDir) || !statSync(scriptsDir).isDirectory()) {
    return undefined;
  }
  const scripts: string[] = [];
  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      scripts.push(normalizePath(relative(root, join(scriptsDir, entry.name))));
    }
  }
  return scripts.length > 0 ? scripts.sort() : undefined;
}

function normalizePath(path: string) {
  return path.split("\\").join("/");
}
