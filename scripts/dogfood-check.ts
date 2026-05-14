/**
 * Dogfood compliance check: verifies that every gxpm issue created
 * after SPECIFY_PHASE_CUTOFF has gone through the specify phase before
 * reaching implement (or any phase past it).
 *
 * Default mode is informational (exit 0, print warnings).
 * Pass `--strict` to make non-compliant issues fail the check (exit 1).
 *
 * Run: bun run scripts/dogfood-check.ts [--strict]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SPECIFY_PHASE_CUTOFF } from "../core/state";

const PAST_SPECIFY_PHASES = new Set([
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "verify",
  "qa",
  "land",
]);

interface IssueViolation {
  issueId: string;
  currentPhase: string;
  reason: string;
}

export interface DogfoodReport {
  scanned: number;
  legacyExempt: number;
  compliant: number;
  violations: IssueViolation[];
}

export function runDogfoodCheck(root: string = process.cwd()): DogfoodReport {
  const issuesDir = join(root, ".gxpm", "issues");
  const report: DogfoodReport = {
    scanned: 0,
    legacyExempt: 0,
    compliant: 0,
    violations: [],
  };

  if (!existsSync(issuesDir)) {
    return report;
  }

  for (const entry of readdirSync(issuesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const issueId = entry.name;
    const statePath = join(issuesDir, issueId, "state.json");
    if (!existsSync(statePath)) continue;

    let state: { currentPhase?: string; phaseHistory?: Array<{ phase: string; enteredAt: string }> };
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      report.violations.push({
        issueId,
        currentPhase: "<unreadable>",
        reason: "state.json is not valid JSON",
      });
      continue;
    }

    report.scanned++;
    const phase = state.currentPhase ?? "<missing>";

    if (!PAST_SPECIFY_PHASES.has(phase)) {
      // Issue not yet at implement; specify is not strictly required yet.
      report.compliant++;
      continue;
    }

    const history = state.phaseHistory ?? [];
    const implementEntry = history.find((h) => h.phase === "implement");
    if (implementEntry && implementEntry.enteredAt < SPECIFY_PHASE_CUTOFF) {
      // Legacy issue — exempt per the same rule the phase-gate enforces.
      report.legacyExempt++;
      continue;
    }

    const specifyEntry = history.find((h) => h.phase === "specify");
    if (!specifyEntry) {
      report.violations.push({
        issueId,
        currentPhase: phase,
        reason: "post-cutoff issue reached implement without entering specify",
      });
      continue;
    }

    report.compliant++;
  }

  return report;
}

function formatReport(report: DogfoodReport): string {
  const lines: string[] = [];
  lines.push(`dogfood-check: scanned ${report.scanned} issue(s)`);
  lines.push(`  compliant:     ${report.compliant}`);
  lines.push(`  legacy exempt: ${report.legacyExempt}`);
  lines.push(`  violations:    ${report.violations.length}`);
  for (const v of report.violations) {
    lines.push(`    - ${v.issueId} (in ${v.currentPhase}): ${v.reason}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const strict = process.argv.includes("--strict");
  const root = resolve(process.cwd());
  const report = runDogfoodCheck(root);
  console.log(formatReport(report));
  if (strict && report.violations.length > 0) {
    process.exit(1);
  }
}
