import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(import.meta.dir, "..", "scripts", "gxpm.ts");

function runCli(root: string, args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result: ReturnType<typeof runCli>) {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

describe("gxpm CLI", () => {
  test("creates, reads, and transitions local issue state", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-"));

    const create = runCli(root, ["issue", "create", "GXPM-10"]);
    expect(create.exitCode).toBe(0);
    expect(output(create)).toContain("created GXPM-10 at triage");

    const initialStatus = runCli(root, ["issue", "status", "GXPM-10"]);
    expect(initialStatus.exitCode).toBe(0);
    expect(output(initialStatus)).toContain("currentPhase: triage");

    const triage = runCli(root, ["triage", "init", "GXPM-10"]);
    expect(triage.exitCode).toBe(0);
    expect(output(triage)).toContain("initialized triage artifacts for GXPM-10");

    const transition = runCli(root, ["issue", "transition", "GXPM-10", "plan"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-10: triage -> plan");

    const nextStatus = runCli(root, ["issue", "status", "GXPM-10"]);
    expect(nextStatus.exitCode).toBe(0);
    expect(output(nextStatus)).toContain("currentPhase: plan");
  });

  test("returns non-zero for invalid phase transitions", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-invalid-"));
    expect(runCli(root, ["issue", "create", "GXPM-11"]).exitCode).toBe(0);

    const invalid = runCli(root, ["issue", "transition", "GXPM-11", "dispatch"]);

    expect(invalid.exitCode).toBe(1);
    expect(output(invalid)).toContain("Invalid phase transition");
    expect(output(invalid)).toContain("allowed next phase: plan");
  });
});
