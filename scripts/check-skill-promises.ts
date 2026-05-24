/**
 * check-skill-promises: assert every script + artifact-type referenced in
 * `skills/**\/SKILL.md` actually exists.
 *
 * Catches the drift class found while auditing 0.3.9 skills:
 *   - skill recommends `bun run build` but `package.json` has no such script
 *   - skill recommends `gxpm artifact write <id> handoff --stdin` but
 *     `handoff` is not in ARTIFACT_TYPES (the real type is `phase-handoff`)
 *
 * Mirrors check-cli-promises.ts: pure module + CLI entry, surfaced via
 * scripts/gxpm-check.ts so `bun run check` and `prepublishOnly` both enforce.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_TYPES } from "../core/artifacts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const SKILLS_DIR = "skills";

// `bun run <name>` / `npm run <name>` / `pnpm run <name>`. Negative lookahead
// `(?![.\w])` excludes file-path forms like `bun run scripts/foo.ts` where the
// next char is `.`, and avoids splitting `my-script-v2` mid-token.
const SCRIPT_PATTERN = /\b(?:bun|npm|pnpm)\s+run\s+([a-zA-Z][\w:-]*)(?![.\w/])/g;

// `gxpm artifact <verb> <id> <type>`. Strip placeholders (`<type>`).
const ARTIFACT_PATTERN =
  /\bgxpm\s+artifact\s+(?:write|edit|read|inspect)\s+\S+\s+([a-zA-Z][a-zA-Z0-9-]*)/g;

const ARTIFACT_TYPE_PLACEHOLDERS = new Set([
  "type",
  "artifact-type",
  "TYPE",
  "ARTIFACT",
]);

export type IssueKind = "script" | "artifact-type";

export interface SkillPromiseIssue {
  skill: string;
  file: string;
  kind: IssueKind;
  token: string;
  context: string;
}

export interface SkillPromisesResult {
  ok: boolean;
  issues: SkillPromiseIssue[];
  scanned: number;
}

function collectSkillFiles(repoRoot: string): { skill: string; file: string }[] {
  const dir = join(repoRoot, SKILLS_DIR);
  const out: { skill: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const skillDir = join(dir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillFile = join(skillDir, "SKILL.md");
    try {
      if (statSync(skillFile).isFile()) {
        out.push({ skill: entry, file: skillFile });
      }
    } catch {
      // skill folder without SKILL.md — skip
    }
  }
  return out;
}

function loadPackageScripts(repoRoot: string): Set<string> {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

export function checkSkillPromises(repoRoot: string = REPO_ROOT): SkillPromisesResult {
  const issues: SkillPromiseIssue[] = [];
  const skillFiles = collectSkillFiles(repoRoot);
  const scripts = loadPackageScripts(repoRoot);
  const validArtifactTypes = new Set<string>(ARTIFACT_TYPES);

  for (const { skill, file } of skillFiles) {
    const content = readFileSync(file, "utf-8");

    for (const m of content.matchAll(SCRIPT_PATTERN)) {
      const token = m[1];
      if (!scripts.has(token)) {
        issues.push({ skill, file, kind: "script", token, context: m[0] });
      }
    }

    for (const m of content.matchAll(ARTIFACT_PATTERN)) {
      const token = m[1];
      if (ARTIFACT_TYPE_PLACEHOLDERS.has(token)) continue;
      if (!validArtifactTypes.has(token)) {
        issues.push({ skill, file, kind: "artifact-type", token, context: m[0] });
      }
    }
  }

  return { ok: issues.length === 0, issues, scanned: skillFiles.length };
}

export function formatSkillPromisesResult(r: SkillPromisesResult): string {
  if (r.ok) {
    return `✅ check-skill-promises: ${r.scanned} SKILL.md file(s) scanned, all script + artifact-type references resolve.`;
  }
  const lines = ["❌ check-skill-promises: skill docs reference missing scripts or unknown artifact types"];
  for (const i of r.issues) {
    if (i.kind === "script") {
      lines.push(`  - [${i.skill}] missing package.json script: \`bun run ${i.token}\`  (matched: \`${i.context}\`)`);
    } else {
      lines.push(`  - [${i.skill}] unknown artifact type: \`${i.token}\` (not in core/artifacts.ts ARTIFACT_TYPES)  (matched: \`${i.context}\`)`);
    }
  }
  lines.push("");
  lines.push("Fix: either correct the skill prose, add the missing script to package.json, or update ARTIFACT_TYPES.");
  return lines.join("\n");
}

if (import.meta.main) {
  const result = checkSkillPromises();
  console.log(formatSkillPromisesResult(result));
  if (!result.ok) process.exit(1);
}
