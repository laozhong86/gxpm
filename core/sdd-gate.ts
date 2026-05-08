/**
 * SDD Gate — automated Nine Articles checker.
 *
 * Validates that an implementation-plan artifact passes the Phase -1 Gates
 * before allowing triage → plan advancement.
 *
 * Articles checked automatically:
 *   1. Capability-First      → constitutionCheck.capabilityDeclared
 *   3. Test-First            → constitutionCheck.testStrategyDefined
 *   7. Simplicity Gate       → constitutionCheck.simplicityJustified
 *   9. Integration-First     → constitutionCheck.integrationPathClear
 *
 * Articles requiring human judgment (not automated here):
 *   2. CLI Interface Mandate, 4. Composition, 5. Explicit, 6. Fail Fast, 8. Anti-Abstraction
 */

export interface ConstitutionCheck {
  capabilityDeclared: boolean;
  capabilitySlice?: string;
  testStrategyDefined: boolean;
  testStrategy?: string;
  simplicityJustified: boolean;
  simplicityJustification?: string;
  integrationPathClear: boolean;
  integrationPath?: string;
}

export interface SddGateResult {
  passed: boolean;
  /** Which articles passed */
  passedChecks: string[];
  /** Which articles failed with reasons */
  failedChecks: { article: string; reason: string }[];
  /** Human-judgment articles that require manual review */
  manualReviewArticles: string[];
}

const AUTOMATED_ARTICLES = [
  { key: "capabilityDeclared", name: "Capability-First (Article 1)" },
  { key: "testStrategyDefined", name: "Test-First (Article 3)" },
  { key: "simplicityJustified", name: "Simplicity Gate (Article 7)" },
  { key: "integrationPathClear", name: "Integration-First (Article 9)" },
] as const;

const MANUAL_ARTICLES = [
  "CLI Interface Mandate (Article 2)",
  "Composition over Inheritance (Article 4)",
  "Explicit over Implicit (Article 5)",
  "Fail Fast, Fail Loud (Article 6)",
  "Anti-Abstraction (Article 8)",
];

/**
 * Run automated SDD constitution checks against a constitutionCheck payload.
 */
export function runSddGate(check: Partial<ConstitutionCheck>): SddGateResult {
  const passedChecks: string[] = [];
  const failedChecks: { article: string; reason: string }[] = [];

  for (const article of AUTOMATED_ARTICLES) {
    const value = check[article.key as keyof ConstitutionCheck];
    if (value === true) {
      passedChecks.push(article.name);
    } else {
      failedChecks.push({
        article: article.name,
        reason: `${article.key} is not true`,
      });
    }
  }

  return {
    passed: failedChecks.length === 0,
    passedChecks,
    failedChecks,
    manualReviewArticles: MANUAL_ARTICLES,
  };
}

/**
 * Validate a raw implementation-plan payload and return a typed ConstitutionCheck.
 * Returns null if the payload does not contain a constitutionCheck field.
 */
export function extractConstitutionCheck(
  planPayload: Record<string, unknown>
): ConstitutionCheck | null {
  const raw = planPayload.constitutionCheck;
  if (!raw || typeof raw !== "object") return null;

  const c = raw as Record<string, unknown>;
  return {
    capabilityDeclared: c.capabilityDeclared === true,
    capabilitySlice: typeof c.capabilitySlice === "string" ? c.capabilitySlice : undefined,
    testStrategyDefined: c.testStrategyDefined === true,
    testStrategy: typeof c.testStrategy === "string" ? c.testStrategy : undefined,
    simplicityJustified: c.simplicityJustified === true,
    simplicityJustification: typeof c.simplicityJustification === "string" ? c.simplicityJustification : undefined,
    integrationPathClear: c.integrationPathClear === true,
    integrationPath: typeof c.integrationPath === "string" ? c.integrationPath : undefined,
  };
}

/**
 * Format SDD gate result for CLI output.
 */
export function formatSddGateResult(result: SddGateResult): string {
  const lines: string[] = [];

  lines.push(`SDD Constitution Check: ${result.passed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push("");

  if (result.passedChecks.length > 0) {
    lines.push("Automated checks passed:");
    for (const name of result.passedChecks) {
      lines.push(`  ✅ ${name}`);
    }
  }

  if (result.failedChecks.length > 0) {
    lines.push("");
    lines.push("Automated checks failed:");
    for (const item of result.failedChecks) {
      lines.push(`  ❌ ${item.article}: ${item.reason}`);
    }
  }

  lines.push("");
  lines.push("Manual review required:");
  for (const name of result.manualReviewArticles) {
    lines.push(`  ⚠️  ${name}`);
  }

  return lines.join("\n");
}
