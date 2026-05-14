import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BehaviorSpecSchema, type BehaviorSpec } from "../../core/contracts/behavior-spec.schema";
import { createIssueState } from "../../core/state";
import { confirmSpecify, initializeSpecify, reviseSpecify } from "../../core/specify";

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

describe("initializeSpecify", () => {
  it("writes a draft behavior-spec.json with confirmedAt=null", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-init-specify-"));
    createIssueState({ root, issueId: "G-3", issueType: "feature" });
    // Force phase to specify by direct state file mutation
    const stateFile = join(root, ".gxpm", "issues", "G-3", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));

    const record = initializeSpecify({ root, issueId: "G-3" });
    expect(record.type).toBe("behavior-spec");

    const artPath = join(root, ".gxpm", "issues", "G-3", "artifacts", "behavior-spec.json");
    const written = JSON.parse(readFileSync(artPath, "utf8"));
    expect(written.payload.$schema).toBe("behavior-spec.v1");
    expect(written.payload.confirmedAt).toBeNull();
    expect(written.payload.confirmedBy).toBeNull();
    expect(written.payload.scenarios).toHaveLength(1);
    expect(written.payload.scenarios[0].id).toBe("scn-01");
    rmSync(root, { recursive: true, force: true });
  });

  it("throws when not in specify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-init-specify-wrong-"));
    createIssueState({ root, issueId: "G-4", issueType: "feature" });
    // Default phase after createIssueState is "triage"
    expect(() => initializeSpecify({ root, issueId: "G-4" })).toThrow(/specify phase/);
    rmSync(root, { recursive: true, force: true });
  });

  it("produces a draft that passes BehaviorSpecSchema (so downstream parse won't throw)", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-init-specify-schema-"));
    createIssueState({ root, issueId: "G-5", issueType: "feature" });
    const stateFile = join(root, ".gxpm", "issues", "G-5", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));

    initializeSpecify({ root, issueId: "G-5" });

    const artPath = join(root, ".gxpm", "issues", "G-5", "artifacts", "behavior-spec.json");
    const stored = JSON.parse(readFileSync(artPath, "utf8"));
    expect(() => BehaviorSpecSchema.parse(stored.payload)).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});

function seedConfirmableSpec(root: string, issueId: string, stubFile: string) {
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "behavior-spec.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "behavior-spec",
      writtenAt: "2026-05-14T00:00:00Z",
      payload: {
        $schema: "behavior-spec.v1",
        issueId,
        createdAt: "2026-05-14T00:00:00.000Z",
        createdBy: "specifier",
        confirmedAt: null,
        confirmedBy: null,
        feature: { title: "Real Feature", asA: "user", iWant: "X", soThat: "Y" },
        scenarios: [
          {
            id: "scn-01",
            name: "happy",
            given: ["a real precondition"],
            when: "the action occurs",
            then: ["the outcome is observed"],
            examples: [],
            stubPath: stubFile,
          },
        ],
        guidelinesRef: "docs/governance/gherkin-style.md@v1",
      },
    }, null, 2),
  );
}

describe("confirmSpecify", () => {
  it("writes confirmedAt and confirmedBy when stubPath exists and no placeholders remain", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirm-"));
    createIssueState({ root, issueId: "G-CF1", issueType: "feature" });
    // Stub file exists at root/test/foo.test.ts
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test/foo.test.ts"), "// stub");
    seedConfirmableSpec(root, "G-CF1", "test/foo.test.ts");

    confirmSpecify({ root, issueId: "G-CF1", confirmedBy: "alice@example.com" });

    const artPath = join(root, ".gxpm", "issues", "G-CF1", "artifacts", "behavior-spec.json");
    const after = JSON.parse(readFileSync(artPath, "utf8"));
    expect(after.payload.confirmedAt).not.toBeNull();
    expect(after.payload.confirmedBy).toBe("alice@example.com");
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects confirm when stubPath does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirm-missing-"));
    createIssueState({ root, issueId: "G-CF2", issueType: "feature" });
    seedConfirmableSpec(root, "G-CF2", "test/does-not-exist.test.ts");
    expect(() =>
      confirmSpecify({ root, issueId: "G-CF2", confirmedBy: "alice@example.com" }),
    ).toThrow(/Stub file missing/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects confirm when a <placeholder> sentinel remains in any field", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirm-ph-"));
    createIssueState({ root, issueId: "G-CF3", issueType: "feature" });
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test/foo.test.ts"), "// stub");
    // Use initializeSpecify which leaves <placeholder> everywhere; only stubPath becomes real
    const stateFile = join(root, ".gxpm", "issues", "G-CF3", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));
    initializeSpecify({ root, issueId: "G-CF3" });
    // Patch stubPath to be real so we test the placeholder check, not stub check
    const artPath = join(root, ".gxpm", "issues", "G-CF3", "artifacts", "behavior-spec.json");
    const draft = JSON.parse(readFileSync(artPath, "utf8"));
    draft.payload.scenarios[0].stubPath = "test/foo.test.ts";
    writeFileSync(artPath, JSON.stringify(draft, null, 2));

    expect(() =>
      confirmSpecify({ root, issueId: "G-CF3", confirmedBy: "alice@example.com" }),
    ).toThrow(/<placeholder>/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("reviseSpecify", () => {
  it("clears confirmedAt and confirmedBy", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-revise-"));
    createIssueState({ root, issueId: "G-RV1", issueType: "feature" });
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test/foo.test.ts"), "// stub");
    seedConfirmableSpec(root, "G-RV1", "test/foo.test.ts");
    const artPath = join(root, ".gxpm", "issues", "G-RV1", "artifacts", "behavior-spec.json");
    const before = JSON.parse(readFileSync(artPath, "utf8"));
    before.payload.confirmedAt = "2026-05-14T01:00:00.000Z";
    before.payload.confirmedBy = "alice@example.com";
    writeFileSync(artPath, JSON.stringify(before, null, 2));

    reviseSpecify({ root, issueId: "G-RV1" });

    const after = JSON.parse(readFileSync(artPath, "utf8"));
    expect(after.payload.confirmedAt).toBeNull();
    expect(after.payload.confirmedBy).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
