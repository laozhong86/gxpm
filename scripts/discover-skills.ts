import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface SkillTemplate {
  tmpl: string;
  output: string;
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
        templates.push({
          tmpl,
          output: tmpl.replace(/\.tmpl$/, ""),
        });
      }
    }
  }

  if (statSync(root).isDirectory()) {
    walk(root);
  }

  return templates.sort((a, b) => a.tmpl.localeCompare(b.tmpl));
}

function normalizePath(path: string) {
  return path.split("\\").join("/");
}
