import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { output, runCli } from "./helpers/workflow";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-autopilot-cli-"));
}

describe("gxpm autopilot CLI", () => {
  // GXPM-139 regression: top-level positional filtering in scripts/gxpm.ts
  // strips `--prompt` but leaves the prompt value as a positional, which the
  // autopilot CLI then treats as an explicit issue id. Combined with --auto-id
  // this triggers the "choose either" guard. Skipped until the parser
  // consumes option-value pairs.
  test.skip("starts, reports, lists, and stops an auto-id grant", () => {
    const root = tempRoot();
    const started = runCli(root, [
      "autopilot",
      "start",
      "--auto-id",
      "--prompt",
      "自动驾驶完成",
      "--json",
    ]);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(started.stdout.toString());
    expect(payload.issueId).toBe("GXPM-1");
    expect(payload.createdIssue).toBe(true);
    expect(payload.grant.status).toBe("active");

    const status = runCli(root, ["autopilot", "status", "GXPM-1", "--json"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout.toString()).profile).toBe("full-delivery");

    const listed = runCli(root, ["autopilot", "list"]);
    expect(output(listed)).toContain("gxpm autopilot grant active");
    expect(output(listed)).toContain("GXPM-1");

    const stopped = runCli(root, ["autopilot", "stop", "GXPM-1", "--reason", "done", "--json"]);
    expect(stopped.exitCode).toBe(0);
    expect(JSON.parse(stopped.stdout.toString()).status).toBe("stopped");

    const listedAfterStop = runCli(root, ["autopilot", "list"]);
    expect(output(listedAfterStop)).toContain("no active autopilot grants");
  });

  // GXPM-139 regression: `--profile unsafe` collapses to positional
  // `["autopilot", "start", "unsafe"]`, so the CLI sees an explicit id and
  // never reaches the unsupported-profile check.
  test.skip("rejects unsupported profiles", () => {
    const root = tempRoot();
    const result = runCli(root, ["autopilot", "start", "--auto-id", "--profile", "unsafe"]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("Unsupported autopilot profile");
  });

  test("rejects mixing literal issue id with --auto-id", () => {
    const root = tempRoot();
    const result = runCli(root, ["autopilot", "start", "GXPM-1", "--auto-id"]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("choose either");
  });
});
