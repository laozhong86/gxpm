import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { initializeVerifyFindings } from "../core/verify";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("verify gate", () => {
  test("initializes verify findings only in pr-check phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-init-"));
    createIssueState({ root, issueId: "GXPM-110" });

    expect(() => initializeVerifyFindings({ root, issueId: "GXPM-110" })).toThrow(
      "Verify findings can only be initialized from pr-check phase",
    );

    enterPhase(root, "GXPM-111", "pr-check");
    const artifact = initializeVerifyFindings({ root, issueId: "GXPM-111" });

    expect(artifact.type).toBe("verify-findings");
    expect(readArtifact({ root, issueId: "GXPM-111", type: "verify-findings" }).payload).toEqual({
      acceptanceContractArtifact: "acceptance-contract",
      findings: [],
      prCheckArtifact: "pr-check",
      risks: [],
      status: "draft",
      summary: "",
    });
  });

  test("blocks pr-check to verify until verify findings exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-gate-"));
    enterPhase(root, "GXPM-112", "pr-check");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-112", nextPhase: "verify" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-112", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "verify-findings" },
    });

    initializeVerifyFindings({ root, issueId: "GXPM-112" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-112", nextPhase: "verify" });

    expect(state.currentPhase).toBe("verify");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-112", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.findLast((e) => e.type === "gate.passed")).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "verify-findings" },
    });
  });

  test("CLI supports verify findings init and artifact-backed verify transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-verify-cli-"));
    enterPhaseCli(root, "GXPM-113", "pr-check");

    const blocked = runCli(root, ["issue", "transition", "GXPM-113", "verify"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm pr-check verify GXPM-113");

    const verify = runCli(root, ["pr-check", "verify", "GXPM-113"]);
    expect(verify.exitCode).toBe(0);
    expect(output(verify)).toContain("initialized verify findings artifact for GXPM-113");

    const list = runCli(root, ["artifact", "list", "GXPM-113"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("pr-check");
    expect(output(list)).toContain("verify-findings");

    const read = runCli(root, ["artifact", "read", "GXPM-113", "verify-findings"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-113", "verify"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-113: pr-check -> verify");
  });
});
