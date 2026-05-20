// Feature: Phase → Required Skill contract surfaced by gxpm issue next
//
// As an autonomous agent advancing a gxpm issue
// I want `gxpm issue next` to tell me which gxpm-* skill I must invoke
//   for the current phase before doing any work
// So that I do not silently skip phase-specific discipline
//   (e.g. TDD in implement, review in self-review, hygiene before ship)

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHASE_GATE_RULES,
  type PhaseGateRule,
} from "../core/phase-gates";
import {
  createIssueState,
  transitionIssuePhase,
  type GxpmPhase,
} from "../core/state";
import { writeArtifact } from "../core/artifacts";

// Cross-platform repo root: fileURLToPath produces correct paths on Windows
// (whereas `new URL("../", import.meta.url).pathname` yields "/C:/..." which
// breaks child_process). CodeRabbit review on PR #52 surfaced this.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

function runGxpm(args: string[], root: string) {
  const result = spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, GXPM_ROOT: root, GXPM_TEST: "1" },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function setupIssueAtPhase(targetPhase: GxpmPhase): { root: string; issueId: string } {
  const root = mkdtempSync(join(tmpdir(), "gxpm-issue-next-"));
  mkdirSync(join(root, ".gxpm"), { recursive: true });
  writeFileSync(
    join(root, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "forbidden" } }),
  );
  const issueId = "GXPM-1";
  createIssueState({ root, issueId });

  // Walk PHASE_GATE_RULES from triage forward, writing the minimum payload for
  // each required artifact so the gate accepts the transition.
  let currentPhase: GxpmPhase = "triage";
  while (currentPhase !== targetPhase) {
    const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === currentPhase);
    if (!rule) {
      throw new Error(`No rule from phase ${currentPhase}; cannot reach ${targetPhase}`);
    }
    writeArtifact({
      root,
      issueId,
      type: rule.requiredArtifact,
      payload: minimalPayloadFor(rule.requiredArtifact),
    });
    transitionIssuePhase({ root, issueId, nextPhase: rule.nextPhase });
    currentPhase = rule.nextPhase;
  }
  return { root, issueId };
}

function minimalPayloadFor(type: string): Record<string, unknown> {
  // Minimal payload that satisfies the artifact validator for each gate type.
  // We only need to walk through the state machine, not produce realistic content.
  switch (type) {
    case "acceptance-contract":
      return { criteria: [], status: "draft" };
    case "implementation-plan":
      return { objective: "stub", approach: "stub", validation: { tests: [] } };
    case "dispatch-handoff":
      return { status: "ready", inputArtifacts: [], workerTasks: [] };
    case "behavior-spec":
      return {
        feature: { title: "stub", asA: "x", iWant: "y", soThat: "z" },
        scenarios: [],
        confirmedAt: new Date().toISOString(),
        confirmedBy: "test",
      };
    case "local-verify":
      return { status: "passed", commands: [], results: [] };
    case "acceptance-check":
      return { status: "passed", criteria: [], findings: [] };
    case "self-review":
      return { status: "passed", reviewedArtifacts: [], findings: [] };
    case "cleanup-report":
      return { status: "done" };
    case "ship-readiness":
      return { status: "ready", checklist: [], rollbackPlan: "n/a" };
    case "pr-check":
      return { status: "approved", pullRequest: {}, reviewFindings: [] };
    case "verify-findings":
      return { status: "passed", findings: [], risks: [] };
    case "qa-findings":
      return { status: "passed", findings: [] };
    case "land-findings":
      return { status: "landed" };
    default:
      return {};
  }
}

describe("gxpm issue next — Phase → Required Skill contract", () => {
  const cleanups: string[] = [];

  afterEach(() => {
    for (const path of cleanups) {
      rmSync(path, { recursive: true, force: true });
    }
    cleanups.length = 0;
  });

  // Scenario (scn-02): Machine-readable requiredSkill field via --json
  test("scn-02: requiredSkill is exposed as a machine-readable field via --json", () => {
    const { root, issueId } = setupIssueAtPhase("self-review");
    cleanups.push(root);

    const result = runGxpm(["issue", "next", issueId, "--json"], root);
    const { code, stdout } = result;
    if (code !== 0) {
      throw new Error(`gxpm exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${result.stderr}`);
    }
    expect(code).toBe(0);

    const payload = JSON.parse(stdout);
    expect(payload.requiredSkill).toBe("gxpm-review-changes");
    expect(payload.currentPhase).toBe("self-review");
    expect(payload.nextPhase).toBe("cleanup");
    expect(typeof payload.command).toBe("string");
  });

  // Scenario (scn-01): Required skill surfaces in human-readable output
  test("scn-01: required skill line surfaces in text output during implement phase", () => {
    const { root, issueId } = setupIssueAtPhase("implement");
    cleanups.push(root);

    const { code, stdout } = runGxpm(["issue", "next", issueId], root);
    expect(code).toBe(0);
    expect(stdout).toContain("Required skill: /gxpm-tdd");
    // Reading order: Required skill line precedes the "Next:" hint so the
    // agent encounters the contract before the action.
    const requiredIdx = stdout.indexOf("Required skill:");
    const nextIdx = stdout.indexOf("Next:");
    expect(requiredIdx).toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(-1);
    expect(requiredIdx).toBeLessThan(nextIdx);
  });

  // Scenario (scn-03): Null requiredSkill — JSON exposes null, text omits the line
  test("scn-03: requiredSkill is null for dispatch phase and omitted from text output", () => {
    const { root, issueId } = setupIssueAtPhase("dispatch");
    cleanups.push(root);

    const json = runGxpm(["issue", "next", issueId, "--json"], root);
    expect(json.code).toBe(0);
    const payload = JSON.parse(json.stdout);
    expect(payload.requiredSkill).toBeNull();

    const text = runGxpm(["issue", "next", issueId], root);
    expect(text.code).toBe(0);
    expect(text.stdout).not.toContain("Required skill:");
  });

  // Slice-B will add scn-04 (doc/code sync) once the contract surface is stable.
});

describe("Phase → Required Skill — doc/code sync (scn-04)", () => {
  test("scn-04: main SKILL.md contains a row that matches every PHASE_GATE_RULES.requiredSkill", () => {
    const skillMd = require("node:fs").readFileSync(
      join(REPO_ROOT, "skills/gxpm/SKILL.md"),
      "utf-8",
    ) as string;

    // The contract section must be present.
    expect(skillMd).toContain("Phase → Required Skill (Contract)");

    // For each rule, the rendered table row must reflect the requiredSkill.
    for (const rule of PHASE_GATE_RULES) {
      const expectedSkillCell = rule.requiredSkill
        ? `\`/${rule.requiredSkill}\``
        : "—";
      const rowPattern = new RegExp(
        `\\|\\s*\`${rule.fromPhase}\`\\s*\\|\\s*${expectedSkillCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
      );
      expect(skillMd).toMatch(rowPattern);
    }
  });
});

describe("PHASE_GATE_RULES — Phase → Required Skill contract", () => {
  test("every rule declares a requiredSkill field (string or null)", () => {
    for (const rule of PHASE_GATE_RULES) {
      expect(rule).toHaveProperty("requiredSkill");
      const value = (rule as PhaseGateRule & { requiredSkill: unknown }).requiredSkill;
      expect(value === null || typeof value === "string").toBe(true);
    }
  });

  test("rules for implement, self-review, qa, plan, triage map to the expected gxpm-* skill", () => {
    const expected: Record<string, string | null> = {
      triage: "gxpm-triage",
      plan: "gxpm-planning",
      specify: "gxpm-specifier",
      implement: "gxpm-tdd",
      "self-review": "gxpm-review-changes",
      qa: "gxpm-browser",
    };
    for (const [phase, skill] of Object.entries(expected)) {
      const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === phase);
      expect(rule, `rule for ${phase}`).toBeDefined();
      const got = (rule as PhaseGateRule & { requiredSkill: string | null }).requiredSkill;
      expect(got, `requiredSkill for ${phase}`).toBe(skill);
    }
  });
});
