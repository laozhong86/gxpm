import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeLocalVerify } from "../core/implement";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli } from "./helpers/workflow";

describe("implement gate", () => {
  test("initializes local verify only in implement phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-init-"));
    createIssueState({ root, issueId: "GXPM-60" });

    expect(() => initializeLocalVerify({ root, issueId: "GXPM-60" })).toThrow(
      "Local verify can only be initialized from implement phase",
    );

    enterPhase(root, "GXPM-61", "implement");
    const artifact = initializeLocalVerify({ root, issueId: "GXPM-61" });

    expect(artifact.type).toBe("local-verify");
    expect(readArtifact({ root, issueId: "GXPM-61", type: "local-verify" }).payload).toEqual({
      changedFiles: [],
      commands: [],
      evidence: [],
      results: [],
      risks: [],
      status: "draft",
    });
  });

  test("blocks implement to local-verify until local verify artifact exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-gate-"));
    enterPhase(root, "GXPM-62", "implement");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-62", nextPhase: "local-verify" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-62", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "local-verify" },
    });

    initializeLocalVerify({ root, issueId: "GXPM-62" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-62", nextPhase: "local-verify" });

    expect(state.currentPhase).toBe("local-verify");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-62", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "local-verify" },
    });
  });

  test("CLI supports implement verify and artifact-backed local verify transition", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-implement-cli-"));
    enterPhaseCli(root, "GXPM-63", "implement");

    const blocked = runCli(root, ["issue", "transition", "GXPM-63", "local-verify"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm implement verify GXPM-63");

    const verify = runCli(root, ["implement", "verify", "GXPM-63"]);
    expect(verify.exitCode).toBe(0);
    expect(output(verify)).toContain("initialized local verify artifact for GXPM-63");

    const list = runCli(root, ["artifact", "list", "GXPM-63"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");
    expect(output(list)).toContain("implementation-plan");
    expect(output(list)).toContain("dispatch-handoff");
    expect(output(list)).toContain("local-verify");

    const read = runCli(root, ["artifact", "read", "GXPM-63", "local-verify"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-63", "local-verify"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-63: implement -> local-verify");
  });
});
