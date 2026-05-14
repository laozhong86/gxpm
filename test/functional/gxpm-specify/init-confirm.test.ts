import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GXPM_CLI = resolve(import.meta.dir, "..", "..", "..", "scripts", "gxpm.ts");

function runCli(cwd: string, args: string[]) {
  return spawnSync("bun", ["run", GXPM_CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GXPM_SKIP_POST_LAND_SYNC: "1" },
  });
}

function seedIssueInSpecify(root: string, issueId: string) {
  const issueDir = join(root, ".gxpm", "issues", issueId);
  mkdirSync(join(issueDir, "artifacts"), { recursive: true });
  mkdirSync(join(issueDir, "reports"), { recursive: true });
  mkdirSync(join(issueDir, "evidence", "screenshots"), { recursive: true });
  mkdirSync(join(issueDir, "memory"), { recursive: true });

  const now = "2026-05-14T00:00:00.000Z";

  writeFileSync(
    join(issueDir, "state.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        issueId,
        issueType: "feature",
        rigorLevel: "standard",
        currentPhase: "specify",
        createdAt: now,
        updatedAt: now,
        stateRoot: `.gxpm/issues/${issueId}`,
        artifactRoot: `.gxpm/issues/${issueId}/artifacts`,
        phaseHistory: [
          { phase: "triage", enteredAt: now, fromPhase: null },
          { phase: "plan", enteredAt: now, fromPhase: "triage" },
          { phase: "dispatch", enteredAt: now, fromPhase: "plan" },
          { phase: "specify", enteredAt: now, fromPhase: "dispatch" },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(issueDir, "events.jsonl"), "");
  writeFileSync(
    join(issueDir, "graph.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      phases: [
        "triage",
        "plan",
        "dispatch",
        "specify",
        "implement",
        "local-verify",
        "ac-check",
        "self-review",
        "ship",
        "pr-check",
        "verify",
        "qa",
        "land",
      ],
      currentPhase: "specify",
      transitions: [],
    }),
  );
  writeFileSync(
    join(issueDir, "artifacts", "index.json"),
    JSON.stringify({ schemaVersion: 1, issueId, artifacts: [] }),
  );
}

describe("gxpm specify CLI end-to-end", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gxpm-specify-e2e-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("init produces a draft behavior-spec with confirmedAt=null", () => {
    seedIssueInSpecify(root, "G-E2E-1");
    const r = runCli(root, ["specify", "init", "G-E2E-1"]);
    if (r.status !== 0) {
      throw new Error(`init failed: stdout=${r.stdout}\nstderr=${r.stderr}`);
    }
    const specPath = join(root, ".gxpm", "issues", "G-E2E-1", "artifacts", "behavior-spec.json");
    expect(existsSync(specPath)).toBe(true);
    const stored = JSON.parse(readFileSync(specPath, "utf8"));
    expect(stored.payload.confirmedAt).toBeNull();
    expect(stored.payload.scenarios.length).toBeGreaterThan(0);
  });

  it("confirm fails when stubPath does not exist", () => {
    seedIssueInSpecify(root, "G-E2E-2");
    // Manually craft a behavior-spec with all placeholders cleared but a missing stubPath
    const artPath = join(root, ".gxpm", "issues", "G-E2E-2", "artifacts", "behavior-spec.json");
    writeFileSync(
      artPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          issueId: "G-E2E-2",
          type: "behavior-spec",
          writtenAt: "2026-05-14T00:00:00.000Z",
          payload: {
            $schema: "behavior-spec.v1",
            issueId: "G-E2E-2",
            createdAt: "2026-05-14T00:00:00.000Z",
            createdBy: "test",
            confirmedAt: null,
            confirmedBy: null,
            feature: { title: "T", asA: "u", iWant: "x", soThat: "y" },
            scenarios: [
              {
                id: "scn-01",
                name: "happy",
                given: ["a"],
                when: "b",
                then: ["c"],
                examples: [],
                stubPath: "test/does-not-exist.test.ts",
              },
            ],
            guidelinesRef: "docs/governance/gherkin-style.md@v1",
          },
        },
        null,
        2,
      ),
    );
    const r = runCli(root, ["specify", "confirm", "G-E2E-2"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/Stub file missing/);
  });

  it("confirm succeeds when spec is filled and stubPath exists", () => {
    seedIssueInSpecify(root, "G-E2E-3");
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test/foo.test.ts"), "// stub");
    const artPath = join(root, ".gxpm", "issues", "G-E2E-3", "artifacts", "behavior-spec.json");
    writeFileSync(
      artPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          issueId: "G-E2E-3",
          type: "behavior-spec",
          writtenAt: "2026-05-14T00:00:00.000Z",
          payload: {
            $schema: "behavior-spec.v1",
            issueId: "G-E2E-3",
            createdAt: "2026-05-14T00:00:00.000Z",
            createdBy: "test",
            confirmedAt: null,
            confirmedBy: null,
            feature: { title: "Real", asA: "user", iWant: "x", soThat: "y" },
            scenarios: [
              {
                id: "scn-01",
                name: "happy",
                given: ["a"],
                when: "b",
                then: ["c"],
                examples: [],
                stubPath: "test/foo.test.ts",
              },
            ],
            guidelinesRef: "docs/governance/gherkin-style.md@v1",
          },
        },
        null,
        2,
      ),
    );
    const r = runCli(root, ["specify", "confirm", "G-E2E-3"]);
    if (r.status !== 0) {
      throw new Error(`confirm failed: stdout=${r.stdout}\nstderr=${r.stderr}`);
    }
    const after = JSON.parse(readFileSync(artPath, "utf8"));
    expect(after.payload.confirmedAt).not.toBeNull();
    expect(after.payload.confirmedBy).toBeTruthy();
  });
});
