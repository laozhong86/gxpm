import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { initializePlan } from "../core/plan";
import { initializeTriage } from "../core/triage";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("plan gate", () => {
  test("initializes implementation plan only in plan phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-plan-init-"));
    createIssueState({ root, issueId: "GXPM-40" });

    expect(() => initializePlan({ root, issueId: "GXPM-40" })).toThrow(
      "Plan can only be initialized from plan phase",
    );

    initializeTriage({ root, issueId: "GXPM-40" });
    transitionIssuePhase({ root, issueId: "GXPM-40", nextPhase: "plan" });
    const artifact = initializePlan({ root, issueId: "GXPM-40" });

    expect(artifact.type).toBe("implementation-plan");
    expect(readArtifact({ root, issueId: "GXPM-40", type: "implementation-plan" }).payload).toEqual({
      constitutionCheck: {
        capabilityDeclared: false,
        testStrategyDefined: false,
        simplicityJustified: false,
        integrationPathClear: false,
        status: "pending",
      },
      risks: [],
      status: "draft",
      steps: [],
      summary: "",
      validation: [],
    });
  });

  test("blocks plan to dispatch until implementation plan exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-plan-gate-"));
    enterPhase(root, "GXPM-41", "plan");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-41", nextPhase: "dispatch" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-41", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "implementation-plan" },
    });

    initializePlan({ root, issueId: "GXPM-41" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-41", nextPhase: "dispatch" });

    expect(state.currentPhase).toBe("dispatch");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-41", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "implementation-plan" },
    });
  });

  test("CLI supports plan init and artifact-backed dispatch transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-plan-cli-"));
    enterPhaseCli(root, "GXPM-42", "plan");

    const blocked = runCli(root, ["issue", "transition", "GXPM-42", "dispatch"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm plan init GXPM-42");

    const plan = runCli(root, ["plan", "init", "GXPM-42"]);
    expect(plan.exitCode).toBe(0);
    expect(output(plan)).toContain("initialized plan artifact for GXPM-42");

    const list = runCli(root, ["artifact", "list", "GXPM-42"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("implementation-plan");

    const read = runCli(root, ["artifact", "read", "GXPM-42", "implementation-plan"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-42", "dispatch"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-42: plan -> dispatch");
  });
});
