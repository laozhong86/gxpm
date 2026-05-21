import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeAcceptanceCheck } from "../core/ac-check";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("ac-check gate", () => {
  test("initializes acceptance check only in local-verify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-init-"));
    createIssueState({ root, issueId: "GXPM-70" });

    expect(() => initializeAcceptanceCheck({ root, issueId: "GXPM-70" })).toThrow(
      "Acceptance check can only be initialized from local-verify phase",
    );

    enterPhase(root, "GXPM-71", "local-verify");
    const artifact = initializeAcceptanceCheck({ root, issueId: "GXPM-71" });

    expect(artifact.type).toBe("acceptance-check");
    expect(readArtifact({ root, issueId: "GXPM-71", type: "acceptance-check" }).payload).toEqual({
      adversarialFindings: [],
      criteria: [],
      findings: [],
      localVerifyArtifact: "local-verify",
      specCompliance: {
        missingRequirements: [],
        planCoverage: 0,
        unplannedChanges: [],
      },
      status: "draft",
      summary: "",
    });
  });

  test("blocks local-verify to ac-check until acceptance check exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-gate-"));
    enterPhase(root, "GXPM-72", "local-verify");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-72", nextPhase: "ac-check" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-72", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "acceptance-check" },
    });

    initializeAcceptanceCheck({ root, issueId: "GXPM-72" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-72", nextPhase: "ac-check" });

    expect(state.currentPhase).toBe("ac-check");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-72", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.findLast((e) => e.type === "gate.passed")).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "acceptance-check" },
    });
  });

  test("CLI supports ac-check init and artifact-backed ac-check transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ac-check-cli-"));
    enterPhaseCli(root, "GXPM-73", "local-verify");

    const blocked = runCli(root, ["issue", "transition", "GXPM-73", "ac-check"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm local-verify ac-check GXPM-73");

    const acCheck = runCli(root, ["local-verify", "ac-check", "GXPM-73"]);
    expect(acCheck.exitCode).toBe(0);
    expect(output(acCheck)).toContain("initialized acceptance check artifact for GXPM-73");

    const list = runCli(root, ["artifact", "list", "GXPM-73"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("local-verify");
    expect(output(list)).toContain("acceptance-check");

    const read = runCli(root, ["artifact", "read", "GXPM-73", "acceptance-check"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-73", "ac-check"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-73: local-verify -> ac-check");
  });
});
