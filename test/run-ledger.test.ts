import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import { appendRunEvent, listRuns, readRun, startRun } from "../core/runs";
import { output, runCli } from "./helpers/workflow";

describe("run ledger", () => {
  test("starts, reads, lists, and updates an issue-local run", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-run-ledger-"));
    createIssueState({ root, issueId: "GXPM-1" });

    const started = startRun({
      root,
      issueId: "GXPM-1",
      attempt: 2,
      workspacePath: "/tmp/workspace/GXPM-1",
      message: "manual smoke",
    });

    expect(started.runId).toMatch(/^run-/);
    expect(started.status).toBe("preparing-workspace");
    expect(started.attempt).toBe(2);
    expect(started.events).toHaveLength(1);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-1", "runs", `${started.runId}.json`))).toBe(true);

    const updated = appendRunEvent({
      root,
      issueId: "GXPM-1",
      runId: started.runId,
      type: "run.failed",
      status: "failed",
      failureReason: "validation failed",
    });

    expect(updated.status).toBe("failed");
    expect(updated.failureReason).toBe("validation failed");
    expect(updated.events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
    expect(readRun({ root, issueId: "GXPM-1", runId: started.runId }).status).toBe("failed");
    expect(listRuns({ root, issueId: "GXPM-1" }).map((run) => run.runId)).toEqual([started.runId]);
  });

  test("CLI starts and updates a run", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-run-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-2"]).exitCode).toBe(0);

    const start = runCli(root, ["run", "start", "GXPM-2", "--workspace", "/tmp/w", "--json"]);
    expect(start.exitCode).toBe(0);
    const run = JSON.parse(output(start));
    expect(run.status).toBe("preparing-workspace");

    const event = runCli(root, [
      "run", "event", "GXPM-2", run.runId,
      "--type", "run.succeeded",
      "--status", "succeeded",
      "--message", "done",
    ]);
    expect(event.exitCode).toBe(0);
    expect(output(event)).toContain("status: succeeded");

    const status = runCli(root, ["run", "status", "GXPM-2", run.runId, "--json"]);
    expect(JSON.parse(output(status)).events.at(-1)).toMatchObject({
      type: "run.succeeded",
      status: "succeeded",
    });

    const raw = readFileSync(join(root, ".gxpm", "issues", "GXPM-2", "runs", `${run.runId}.json`), "utf8");
    expect(JSON.parse(raw).workspacePath).toBe("/tmp/w");
  });

  test("rejects invalid statuses", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-run-invalid-"));
    createIssueState({ root, issueId: "GXPM-3" });

    expect(() => startRun({ root, issueId: "GXPM-3", status: "unknown" })).toThrow("Invalid run status");
  });
});
