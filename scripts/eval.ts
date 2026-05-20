#!/usr/bin/env bun
/**
 * gxpm-eval — lightweight skill quality eval harness.
 *
 * Static analysis of SKILL.md files: structure, frontmatter, triggers, length.
 * Future iterations can add LLM-based output quality scoring.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { discoverTemplates } from "./discover-skills";

interface EvalResult {
  skill: string;
  score: number;
  maxScore: number;
  checks: EvalCheck[];
  type: string;
}

interface EvalCheck {
  name: string;
  pass: boolean;
  message: string;
}

const ROOT = join(import.meta.dir, "..");

type SkillType = "discipline" | "technique" | "pattern" | "reference" | "unknown";

function detectSkillType(content: string): SkillType {
  // 1. Frontmatter type field
  const typeMatch = content.match(/^type:\s*(.+)$/m);
  if (typeMatch) {
    const t = typeMatch[1].trim().toLowerCase();
    if (["discipline", "technique", "pattern", "reference"].includes(t)) {
      return t as SkillType;
    }
  }

  // 2. Content heuristic: strong signals of a discipline skill
  const disciplineSignals = [
    /## The Iron Law/i,
    /## Red Flags/i,
    /## Common Rationalizations/i,
    /\*\*No exceptions:\*\*/i,
    /Violating the letter/i,
  ];
  if (disciplineSignals.some((re) => re.test(content))) {
    return "discipline";
  }

  return "unknown";
}

function evaluateSkill(skillPath: string, content: string): EvalResult {
  const checks: EvalCheck[] = [];
  const lines = content.split("\n");
  const skillType = detectSkillType(content);

  // 1. Frontmatter exists
  const hasFrontmatter = content.startsWith("---");
  checks.push({
    name: "frontmatter",
    pass: hasFrontmatter,
    message: hasFrontmatter ? "Has YAML frontmatter" : "Missing YAML frontmatter",
  });

  // 2. Name field
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const hasName = !!nameMatch && nameMatch[1].trim().length > 0;
  checks.push({
    name: "name",
    pass: hasName,
    message: hasName ? `Name: ${nameMatch![1].trim()}` : "Missing 'name' in frontmatter",
  });

  // 3. Description field
  const descMatch = content.match(/^description:\s*(.+)$/m);
  const desc = descMatch ? descMatch[1].trim() : "";
  const descOk = desc.length >= 20 && desc.length <= 300;
  checks.push({
    name: "description",
    pass: descOk,
    message: descOk
      ? `Description length: ${desc.length}`
      : `Description length ${desc.length} (want 20-300)`,
  });

  // 4. Has trigger section
  const hasTrigger = /## When to trigger|## Commands|## Trigger/i.test(content);
  checks.push({
    name: "triggers",
    pass: hasTrigger,
    message: hasTrigger ? "Has trigger/commands section" : "Missing trigger/commands section",
  });

  // 5. Reasonable length
  const lineCount = lines.length;
  const lengthOk = lineCount >= 10 && lineCount <= 1000;
  checks.push({
    name: "length",
    pass: lengthOk,
    message: lengthOk ? `${lineCount} lines` : `${lineCount} lines (want 10-1000)`,
  });

  // 6. Has references or read next
  const hasReferences = /## Read Next|## References|## See Also/i.test(content);
  checks.push({
    name: "references",
    pass: hasReferences,
    message: hasReferences ? "Has references/read-next section" : "Missing references/read-next",
  });

  // 7–10. Discipline-specific structural checks
  if (skillType === "discipline") {
    const hasRationalization = /\|\s*Excuse\s*\|\s*Reality\s*\|/i.test(content);
    checks.push({
      name: "rationalization-table",
      pass: hasRationalization,
      message: hasRationalization
        ? "Has rationalization table (Excuse / Reality)"
        : "Missing rationalization table",
    });

    const hasRedFlags = /## Red Flags/i.test(content);
    checks.push({
      name: "red-flags",
      pass: hasRedFlags,
      message: hasRedFlags ? "Has Red Flags section" : "Missing Red Flags section",
    });

    const hasExplicitNegation = /\*\*No exceptions:\*\*/i.test(content);
    checks.push({
      name: "explicit-negation",
      pass: hasExplicitNegation,
      message: hasExplicitNegation
        ? "Has explicit negation (No exceptions)"
        : "Missing explicit negation clause",
    });

    const hasFoundationalPrinciple = /Violating the letter/i.test(content);
    checks.push({
      name: "foundational-principle",
      pass: hasFoundationalPrinciple,
      message: hasFoundationalPrinciple
        ? "Has foundational principle"
        : "Missing foundational principle (e.g. 'Violating the letter')",
    });
  }

  const passCount = checks.filter((c) => c.pass).length;
  const maxScore = checks.length * 10;
  const score = passCount * 10;

  return { skill: skillPath, score, maxScore, checks, type: skillType };
}

function listSkills(): string[] {
  const templates = discoverTemplates(ROOT);
  return templates.map((t) => t.name);
}

function runEval(skillName?: string, root?: string): EvalResult[] {
  const evalRoot = root ?? ROOT;
  const templates = discoverTemplates(evalRoot);
  const toEval = skillName
    ? templates.filter((t) => t.name === skillName)
    : templates;

  return toEval.map((t) => {
    const readPath = join(evalRoot, t.tmpl.endsWith(".tmpl") ? t.output : t.tmpl);
    let content: string;
    try {
      content = readFileSync(readPath, "utf8");
    } catch (err) {
      // For templated skills, a missing generated SKILL.md typically means
      // `.tmpl` was edited but `bun run gen:skill-docs` hasn't run yet — the
      // remediation is to regenerate. For non-templated skills, the source
      // .md is simply gone and gen-skill-docs cannot help. Tailor the message
      // so the aggregator surfaces actionable guidance instead of misdirecting
      // the user to a regeneration step that won't fix anything.
      const isMissing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
      const isGenerated = t.tmpl.endsWith(".tmpl");
      let message: string;
      if (isMissing && isGenerated) {
        message = `generated file ${t.output} missing; run 'bun run gen:skill-docs' to regenerate from ${t.tmpl}`;
      } else if (isMissing) {
        message = `source file ${t.tmpl} is missing`;
      } else {
        message = `failed to read ${readPath}: ${err instanceof Error ? err.message : String(err)}`;
      }
      return {
        skill: t.name,
        score: 0,
        maxScore: 60,
        checks: [{ name: "file-exists", pass: false, message }],
        type: "unknown",
      };
    }
    return evaluateSkill(t.name, content);
  });
}

export const DEFAULT_SKILL_EVAL_THRESHOLD = 90;

export interface ValidateSkillEvalOptions {
  root?: string;
  threshold?: number;
}

/**
 * GXPM-155: pure validation entrypoint for skill quality gating.
 *
 * Runs the static eval over every discoverable skill and returns one error
 * string per skill scoring below `threshold` (defaults to 90%). Returns []
 * when every skill clears the bar. Designed to be composed by gxpm-check.
 */
export function validateSkillEval(options: ValidateSkillEvalOptions = {}): string[] {
  const threshold = options.threshold ?? DEFAULT_SKILL_EVAL_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      `validateSkillEval: threshold must be a finite number >= 0; got ${threshold}`,
    );
  }
  const results = runEval(undefined, options.root);
  const errors: string[] = [];
  for (const r of results) {
    // Compare on the raw percentage to avoid 89.7 rounding up to 90 and
    // silently slipping past a threshold:90 gate.
    const rawPct = r.maxScore > 0 ? (r.score / r.maxScore) * 100 : 0;
    if (rawPct < threshold) {
      const pct = Math.round(rawPct);
      const failingChecks = r.checks
        .filter((c) => !c.pass)
        .map((c) => c.name)
        .join(", ");
      errors.push(
        `skill ${r.skill}: ${pct}% (${r.score}/${r.maxScore}) below threshold ${threshold}%; failing: ${failingChecks || "(unknown)"}`,
      );
    }
  }
  return errors;
}

function formatReport(results: EvalResult[], asJson: boolean): string {
  if (asJson) {
    return JSON.stringify({ evaluated: results.length, results }, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Evaluated ${results.length} skill(s)`);
  lines.push("");

  for (const r of results) {
    const pct = Math.round((r.score / r.maxScore) * 100);
    const icon = pct >= 80 ? "✓" : pct >= 50 ? "~" : "✗";
    lines.push(`${icon} ${r.skill}: ${r.score}/${r.maxScore} (${pct}%) [type: ${r.type}]`);
    for (const c of r.checks) {
      const cicon = c.pass ? "  ✓" : "  ✗";
      lines.push(`${cicon} ${c.name}: ${c.message}`);
    }
    lines.push("");
  }

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const totalMax = results.reduce((s, r) => s + r.maxScore, 0);
  const totalPct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  lines.push(`Overall: ${totalScore}/${totalMax} (${totalPct}%)`);

  return lines.join("\n");
}

function usage() {
  console.log(`gxpm-eval — skill quality eval harness

Usage:
  gxpm-eval list
  gxpm-eval run [<skill-name>] [--json]

Commands:
  list              List all discoverable skills
  run               Run eval on all skills or a specific skill
`);
}

// Only execute CLI logic when invoked directly. Without this guard, importing
// validateSkillEval from scaffold-check or tests would print the usage banner
// and call process.exit(0) on module load.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  const asJson = args.includes("--json");

  if (command === "list") {
    const skills = listSkills();
    if (asJson) {
      console.log(JSON.stringify({ skills }, null, 2));
    } else {
      console.log(skills.join("\n"));
    }
  } else if (command === "run") {
    const skillName = args[1]?.startsWith("-") ? undefined : args[1];
    const results = runEval(skillName);
    console.log(formatReport(results, asJson));
    const totalScore = results.reduce((s, r) => s + r.score, 0);
    const totalMax = results.reduce((s, r) => s + r.maxScore, 0);
    const totalPct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
    if (totalPct < 50) process.exit(1);
  } else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}
