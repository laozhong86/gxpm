/**
 * GXPM-146: helpers that distinguish wiki-only evidence from real evidence
 * (git diff, GitNexus impact, test logs, browser screenshots).
 *
 * This module is intentionally pure: it does not throw, does not block any
 * write path. Callers (artifact validator integration, doctor checks,
 * future review skill) can consult it to decide whether to warn.
 *
 * Integration into the artifact validator is intentional follow-up scope —
 * blocking writes today would break historical artifacts that may be
 * wiki-only by accident.
 */

/**
 * Returns true if `evidence` contains at least one non-wiki source.
 * Real-evidence signals (any of these substrings — case-insensitive):
 *   - 'git diff' / 'git log' / 'git show'
 *   - 'gitnexus_impact' / 'gitnexus_detect' / 'gitnexus impact'
 *   - 'test:' / 'tests passed' / '/test/' / '.test.ts' / '.spec.ts'
 *   - 'bun test' / 'npm test' / 'yarn test'
 *   - browser/screenshot evidence paths ('.png', 'screenshot', 'evidence/')
 *
 * `evidence` can be:
 *   - undefined / null   → false (no evidence at all)
 *   - string             → scanned for signals
 *   - string[]           → any element with a signal → true
 *   - { ... }            → values scanned recursively (shallow)
 */
export function evidenceContainsNonWikiSource(evidence: unknown): boolean {
  const signals = [
    "git diff",
    "git log",
    "git show",
    "gitnexus_impact",
    "gitnexus_detect",
    "gitnexus impact",
    "bun test",
    "npm test",
    "yarn test",
    ".test.ts",
    ".test.tsx",
    ".spec.ts",
    "/test/",
    "tests passed",
    "screenshot",
    "evidence/",
    ".png",
  ];

  const haystack = collectStrings(evidence);
  if (haystack.length === 0) return false;
  const lowered = haystack.map((s) => s.toLowerCase());
  return signals.some((sig) => lowered.some((s) => s.includes(sig.toLowerCase())));
}

/**
 * Inverse helper: returns true if evidence is *only* wiki references
 * (or empty). Useful for warning UI: when this is true, the reviewer
 * should be prompted to add real evidence.
 */
export function evidenceIsWikiOnly(evidence: unknown): boolean {
  const haystack = collectStrings(evidence);
  if (haystack.length === 0) return true;
  return haystack.every((s) => s.toLowerCase().includes("wiki://"));
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) out.push(...collectStrings(v, depth + 1));
    return out;
  }
  if (typeof value === "object") {
    const out: string[] = [];
    for (const v of Object.values(value)) out.push(...collectStrings(v, depth + 1));
    return out;
  }
  return [];
}
