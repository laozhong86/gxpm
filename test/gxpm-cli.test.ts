import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { output, runCli } from "./helpers/workflow";

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

describe("gxpm artifact write CLI", () => {
  test("writes artifact from --json flag", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-json-"));
    expect(runCli(root, ["issue", "create", "GXPM-20"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-20", "acceptance-contract",
      "--json", '{"criteria":[{"id":"AC-1","statement":"x"}]}',
    ]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("wrote acceptance-contract");

    const read = runCli(root, ["artifact", "read", "GXPM-20", "acceptance-contract"]);
    expect(output(read)).toContain('"AC-1"');
  });

  test("writes artifact from --from <file>", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-file-"));
    expect(runCli(root, ["issue", "create", "GXPM-21"]).exitCode).toBe(0);
    const fixturePath = join(root, "payload.json");
    await Bun.write(fixturePath, '{"summary":"from file"}');

    const r = runCli(root, [
      "artifact", "write", "GXPM-21", "triage-report",
      "--from", fixturePath,
    ]);
    expect(r.exitCode).toBe(0);

    const read = runCli(root, ["artifact", "read", "GXPM-21", "triage-report"]);
    expect(output(read)).toContain('"from file"');
  });

  test("rejects invalid artifact type", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-bad-"));
    expect(runCli(root, ["issue", "create", "GXPM-22"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-22", "unknown-type",
      "--json", "{}",
    ]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("Invalid artifact type");
  });

  test("rejects malformed JSON payload", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-malformed-"));
    expect(runCli(root, ["issue", "create", "GXPM-23"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-23", "acceptance-contract",
      "--json", "{not json",
    ]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("invalid JSON");
  });

  test("requires one of --json / --from / --stdin", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-noinput-"));
    expect(runCli(root, ["issue", "create", "GXPM-24"]).exitCode).toBe(0);

    const r = runCli(root, ["artifact", "write", "GXPM-24", "acceptance-contract"]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("--json");
  });
});
