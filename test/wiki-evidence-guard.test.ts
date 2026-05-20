import { describe, test, expect } from "bun:test";
import { evidenceContainsNonWikiSource, evidenceIsWikiOnly } from "../core/evidence-guard";

describe("GXPM-146: evidence guard helpers", () => {
  test("scn-01: pure wiki evidence is insufficient", () => {
    expect(evidenceContainsNonWikiSource(["wiki://foo", "wiki://bar"])).toBe(false);
    expect(evidenceIsWikiOnly(["wiki://foo"])).toBe(true);
  });

  test("scn-02: evidence containing 'git diff' is sufficient", () => {
    expect(evidenceContainsNonWikiSource("ran git diff origin/main...HEAD; 12 files changed")).toBe(true);
    expect(evidenceIsWikiOnly("ran git diff origin/main...HEAD")).toBe(false);
  });

  test("scn-03: evidence containing GitNexus impact is sufficient", () => {
    expect(evidenceContainsNonWikiSource("gitnexus_impact(target: addIssueRelation) HIGH risk")).toBe(true);
  });

  test("scn-04: empty evidence is insufficient", () => {
    expect(evidenceContainsNonWikiSource([])).toBe(false);
    expect(evidenceContainsNonWikiSource(null)).toBe(false);
    expect(evidenceContainsNonWikiSource(undefined)).toBe(false);
    expect(evidenceIsWikiOnly(null)).toBe(true);
  });

  test("bonus: nested object evidence is scanned", () => {
    const evidence = {
      browser: "evidence/screenshots/checkout.png",
      wiki: ["wiki://foo"],
    };
    expect(evidenceContainsNonWikiSource(evidence)).toBe(true);
  });

  test("bonus: test log path counts as real evidence", () => {
    expect(evidenceContainsNonWikiSource("see test/cli-help-paths.test.ts 16/16 passed")).toBe(true);
  });

  test("bonus: wiki + git diff array → not wiki-only", () => {
    expect(evidenceIsWikiOnly(["wiki://process/foo", "git diff origin/main"])).toBe(false);
  });
});
