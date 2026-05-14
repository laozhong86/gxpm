import { describe, expect, it } from "bun:test";
import { BehaviorSpecSchema, type BehaviorSpec } from "../../core/contracts/behavior-spec.schema";

describe("BehaviorSpecSchema", () => {
  it("accepts a minimal valid spec", () => {
    const valid: BehaviorSpec = {
      $schema: "behavior-spec.v1",
      issueId: "GXPM-001",
      createdAt: "2026-05-14T00:00:00.000Z",
      createdBy: "specifier@test",
      confirmedAt: null,
      confirmedBy: null,
      feature: { title: "T", asA: "user", iWant: "X", soThat: "Y" },
      scenarios: [
        {
          id: "scn-01",
          name: "happy",
          given: ["a"],
          when: "b",
          then: ["c"],
          examples: [],
          stubPath: "test/foo.test.ts:test_x",
        },
      ],
      guidelinesRef: "docs/governance/gherkin-style.md@v1",
    };
    expect(() => BehaviorSpecSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty scenarios array", () => {
    const invalid = { scenarios: [] };
    expect(() => BehaviorSpecSchema.parse(invalid)).toThrow();
  });

  it("rejects scenario missing given/when/then", () => {
    const invalid = {
      $schema: "behavior-spec.v1",
      scenarios: [{ id: "x", name: "n", given: [], when: "", then: [] }],
    };
    expect(() => BehaviorSpecSchema.parse(invalid)).toThrow();
  });

  it("rejects confirmedAt set when confirmedBy is null", () => {
    const invalid = {
      $schema: "behavior-spec.v1",
      issueId: "GXPM-001",
      createdAt: "2026-05-14T00:00:00.000Z",
      createdBy: "specifier@test",
      confirmedAt: "2026-05-14T01:00:00.000Z",
      confirmedBy: null,
      feature: { title: "T", asA: "user", iWant: "X", soThat: "Y" },
      scenarios: [
        {
          id: "scn-01",
          name: "happy",
          given: ["a"],
          when: "b",
          then: ["c"],
          examples: [],
          stubPath: "test/foo.test.ts:test_x",
        },
      ],
      guidelinesRef: "docs/governance/gherkin-style.md@v1",
    };
    expect(() => BehaviorSpecSchema.parse(invalid)).toThrow(/confirmedAt and confirmedBy/);
  });
});
