import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeShipReadiness } from "../core/ship";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("ship gate", () => {
  test("initializes ship readiness only in self-review phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-init-"));
    createIssueState({ root, issueId: "GXPM-90" });

    expect(() => initializeShipReadiness({ root, issueId: "GXPM-90" })).toThrow(
      "Ship readiness can only be initialized from self-review phase",
    );

    enterPhase(root, "GXPM-91", "self-review");
    const artifact = initializeShipReadiness({ root, issueId: "GXPM-91" });

    expect(artifact.type).toBe("ship-readiness");
    expect(readArtifact({ root, issueId: "GXPM-91", type: "ship-readiness" }).payload).toEqual({
      checklist: [],
      compatibilityMigration: {
        backwardCompatible: true,
        configChanges: false,
        migrationSteps: "",
      },
      blastRadius: {
        affectedSubsystems: [],
        guardrails: "",
        unintendedEffects: "",
      },
      humanVerification: {
        edgeCases: "",
        notVerified: "",
        verifiedScenarios: "",
      },
      releaseNotes: "",
      reviewedArtifacts: ["self-review", "acceptance-check"],
      risks: [],
      risksAndMitigations: [],
      rollbackPlan: {
        failureSymptoms: "",
        featureFlags: "",
        rollbackCommand: "",
      },
      securityImpact: {
        fileSystemAccessChanged: false,
        networkCallsChanged: false,
        newPermissionsOrCapabilities: false,
        riskAndMitigation: "",
        secretsHandlingChanged: false,
      },
      status: "draft",
      summary: "",
      targetBranch: "",
    });
  });

  test("blocks self-review to ship until ship readiness exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-gate-"));
    enterPhase(root, "GXPM-92", "self-review");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-92", nextPhase: "ship" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-92", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "ship-readiness" },
    });

    initializeShipReadiness({ root, issueId: "GXPM-92" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-92", nextPhase: "ship" });

    expect(state.currentPhase).toBe("ship");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-92", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "ship-readiness" },
    });
  });

  test("CLI supports ship readiness init and artifact-backed ship transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ship-cli-"));
    enterPhaseCli(root, "GXPM-93", "self-review");

    const blocked = runCli(root, ["issue", "transition", "GXPM-93", "ship"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm self-review ship GXPM-93");

    const ship = runCli(root, ["self-review", "ship", "GXPM-93"]);
    expect(ship.exitCode).toBe(0);
    expect(output(ship)).toContain("initialized ship readiness artifact for GXPM-93");

    const list = runCli(root, ["artifact", "list", "GXPM-93"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("self-review");
    expect(output(list)).toContain("ship-readiness");

    const read = runCli(root, ["artifact", "read", "GXPM-93", "ship-readiness"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-93", "ship"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-93: self-review -> ship");
  });
});
