import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { readArtifact } from "../core/artifacts";
import { initializeTriage } from "../core/triage";
import { output, runCli } from "./helpers/workflow";

describe("triage gate", () => {
  test("blocks triage to plan until an acceptance contract exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-triage-gate-"));
    createIssueState({ root, issueId: "GXPM-30" });

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-30", nextPhase: "plan" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(
      join(root, ".gxpm", "issues", "GXPM-30", "events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "acceptance-contract" },
    });

    initializeTriage({ root, issueId: "GXPM-30" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-30", nextPhase: "plan" });

    expect(state.currentPhase).toBe("plan");
    expect(readArtifact({ root, issueId: "GXPM-30", type: "acceptance-contract" }).payload).toEqual({
      criteria: [],
      notes: "Fill criteria during triage before planning work.",
      status: "draft",
    });
  });

  test("CLI initializes triage artifacts and exposes artifact list/read", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-triage-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-31"]).exitCode).toBe(0);

    const blocked = runCli(root, ["issue", "transition", "GXPM-31", "plan"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm triage init GXPM-31");

    const triage = runCli(root, ["triage", "init", "GXPM-31"]);
    expect(triage.exitCode).toBe(0);
    expect(output(triage)).toContain("initialized triage artifacts for GXPM-31");

    const list = runCli(root, ["artifact", "list", "GXPM-31"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("acceptance-contract");

    const read = runCli(root, ["artifact", "read", "GXPM-31", "acceptance-contract"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-31", "plan"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-31: triage -> plan");
  });
});
