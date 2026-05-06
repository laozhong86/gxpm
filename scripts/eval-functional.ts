#!/usr/bin/env bun
/**
 * gxpm-eval-functional — functional eval runner for discipline skills.
 *
 * Reads pressure scenarios from test/functional/<skill-name>/,
 * runs them WITH and WITHOUT the skill, and reports compliance rates.
 *
 * Skeleton (P1-4): scenario parsing, CLI, report format.
 * Full LLM-based agent evaluation to be wired in Phase-3.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

interface PressureScenario {
  name: string;
  pressures: string[];
  options: string[];
  expected: string;
  rationale: string;
}

interface ScenarioResult {
  scenario: string;
  withSkill: {
    choice: string;
    compliant: boolean;
    citedSections: string[];
  };
  withoutSkill: {
    choice: string;
    compliant: boolean;
    rationalizations: string[];
  };
  metaTest?: {
    question: string;
    response: string;
    improvement: string;
  };
}

interface EvalReport {
  skill: string;
  evaluatedAt: string;
  summary: {
    total: number;
    withSkillCompliant: number;
    withoutSkillNonCompliant: number;
    citationAccuracy: number;
    newRationalizations: string[];
  };
  results: ScenarioResult[];
}

function discoverScenarios(skillName: string): PressureScenario[] {
  const dir = join(ROOT, "test", "functional", skillName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }

  const scenarios: PressureScenario[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const content = readFileSync(join(dir, entry.name), "utf8");
      const parsed = parseScenario(content);
      if (parsed) scenarios.push({ ...parsed, name: entry.name.replace(/\.md$/, "") });
    }
  }
  return scenarios;
}

function parseScenario(content: string): Omit<PressureScenario, "name"> | null {
  const pressuresMatch = content.match(/## Pressures\n([\s\S]*?)(?=\n## |$)/);
  const optionsMatch = content.match(/## Options\n([\s\S]*?)(?=\n## |$)/);
  const expectedMatch = content.match(/## Expected\n([\s\S]*?)(?=\n## |$)/);
  const rationaleMatch = content.match(/## Rationale\n([\s\S]*?)(?=\n## |$)/);

  if (!pressuresMatch || !optionsMatch || !expectedMatch) return null;

  return {
    pressures: pressuresMatch[1].trim().split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()),
    options: optionsMatch[1].trim().split("\n").filter((l) => /^[A-C]\)/.test(l)).map((l) => l.trim()),
    expected: expectedMatch[1].trim(),
    rationale: rationaleMatch ? rationaleMatch[1].trim() : "",
  };
}

function runScenario(skillName: string, scenario: PressureScenario): ScenarioResult {
  // Skeleton: placeholder for LLM agent execution.
  // Phase-3 will wire actual subagent calls via core/dag-executor.ts.
  return {
    scenario: scenario.name,
    withSkill: {
      choice: scenario.expected,
      compliant: true,
      citedSections: [],
    },
    withoutSkill: {
      choice: "B",
      compliant: false,
      rationalizations: [],
    },
  };
}

function buildReport(skillName: string, results: ScenarioResult[]): EvalReport {
  const withSkillCompliant = results.filter((r) => r.withSkill.compliant).length;
  const withoutSkillNonCompliant = results.filter((r) => !r.withoutSkill.compliant).length;
  const totalCitations = results.reduce((s, r) => s + r.withSkill.citedSections.length, 0);
  const citationAccuracy = results.length > 0 ? totalCitations / results.length : 0;
  const newRationalizations = results.flatMap((r) => r.withoutSkill.rationalizations);

  return {
    skill: skillName,
    evaluatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      withSkillCompliant,
      withoutSkillNonCompliant,
      citationAccuracy,
      newRationalizations,
    },
    results,
  };
}

function formatReport(report: EvalReport, asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Functional eval: ${report.skill}`);
  lines.push(`Evaluated at: ${report.evaluatedAt}`);
  lines.push("");
  lines.push(`Scenarios: ${report.summary.total}`);
  lines.push(`With skill compliant: ${report.summary.withSkillCompliant}/${report.summary.total}`);
  lines.push(`Without skill non-compliant: ${report.summary.withoutSkillNonCompliant}/${report.summary.total}`);
  lines.push(`Citation accuracy: ${(report.summary.citationAccuracy * 100).toFixed(0)}%`);
  if (report.summary.newRationalizations.length > 0) {
    lines.push("");
    lines.push("New rationalizations found:");
    for (const r of report.summary.newRationalizations) {
      lines.push(`  - ${r}`);
    }
  }
  return lines.join("\n");
}

function discoverDisciplineSkills(): string[] {
  // Skeleton: discover skills with type=discipline or discipline signals.
  // For now, hardcode the known discipline skills.
  return ["gxpm-tdd", "gxpm-triage"];
}

function usage() {
  console.log(`gxpm-eval-functional — functional eval runner for discipline skills

Usage:
  gxpm-eval-functional run --all [--json]
  gxpm-eval-functional run <skill-name> [--json]

Commands:
  run --all         Run all discipline skills
  run <skill-name>  Run a specific skill
`);
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

const asJson = args.includes("--json");

if (command === "run") {
  const target = args[1];
  if (!target) {
    console.error("Missing target. Use --all or a skill name.");
    usage();
    process.exit(1);
  }

  const skills = target === "--all" ? discoverDisciplineSkills() : [target];
  const reports: EvalReport[] = [];

  for (const skill of skills) {
    const scenarios = discoverScenarios(skill);
    if (scenarios.length === 0) {
      console.error(`No scenarios found for ${skill} (expected test/functional/${skill}/*.md)`);
      continue;
    }
    const results = scenarios.map((s) => runScenario(skill, s));
    reports.push(buildReport(skill, results));
  }

  if (reports.length === 0) {
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify({ evaluated: reports.length, reports }, null, 2));
  } else {
    for (const report of reports) {
      console.log(formatReport(report, false));
      console.log("");
    }
  }
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}
