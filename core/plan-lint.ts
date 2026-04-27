import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PHASE_KEYWORDS = [
  "triage",
  "plan",
  "dispatch",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "verify",
  "qa",
  "land",
];
const TRANSITION_KEYWORDS = ["transition", "推进到", "next phase", "phase"];

export interface PlanLintItem {
  text: string;
  matchedKeywords: string[];
}

export interface PlanLintFindings {
  hasFindings: boolean;
  items: PlanLintItem[];
}

export function lintCodexPlans(root: string, issueId: string): PlanLintFindings {
  const path = join(root, ".gxpm", "issues", issueId, "codex-plans.jsonl");
  if (!existsSync(path)) {
    return { hasFindings: false, items: [] };
  }

  const items = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => extractPlanSteps(JSON.parse(line)));

  const findings = items.flatMap((text) => {
    const matched = [
      ...PHASE_KEYWORDS.filter((keyword) => text.includes(keyword)),
      ...TRANSITION_KEYWORDS.filter((keyword) => text.includes(keyword)),
    ];
    const hasPhase = PHASE_KEYWORDS.some((keyword) => text.includes(keyword));
    const hasTransition = TRANSITION_KEYWORDS.some((keyword) => text.includes(keyword));
    return hasPhase && hasTransition ? [{ text, matchedKeywords: matched }] : [];
  });

  return { hasFindings: findings.length > 0, items: findings };
}

function extractPlanSteps(entry: any): string[] {
  const steps = entry?.arguments?.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => step?.description)
    .filter((value): value is string => typeof value === "string");
}
