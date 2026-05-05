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

function runEval(skillName?: string): EvalResult[] {
  const templates = discoverTemplates(ROOT);
  const toEval = skillName
    ? templates.filter((t) => t.name === skillName)
    : templates;

  return toEval.map((t) => {
    const content = readFileSync(join(ROOT, t.tmpl.endsWith(".tmpl") ? t.output : t.tmpl), "utf8");
    return evaluateSkill(t.name, content);
  });
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
