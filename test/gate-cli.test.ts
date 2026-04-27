import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDispatch } from "../core/dispatch";
import { enterPhase, enterPhaseCli, output, runCli, runCliWithEnv } from "./helpers/workflow";

describe("gxpm gate pre-commit CLI", () => {
  test("blocks code commits in triage", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-cli-block-"));
    enterPhaseCli(root, "GXPM-200", "triage");

    const r = runCli(root, [
      "gate", "pre-commit", "GXPM-200",
      "--staged", "server/src/x.ts",
    ]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("wrong-phase");
  });

  test("allows code commits in implement", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-cli-impl-"));
    enterPhaseCli(root, "GXPM-201", "implement");

    const r = runCli(root, [
      "gate", "pre-commit", "GXPM-201",
      "--staged", "server/src/x.ts",
    ]);
    expect(r.exitCode).toBe(0);
  });

  test("no-ops when state is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-cli-nostate-"));

    const r = runCli(root, [
      "gate", "pre-commit", "GXPM-NOOP",
      "--staged", "server/src/x.ts",
    ]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("no-state");
  });
});

describe("gxpm gate commit-msg CLI", () => {
  test("blocks message without issue ref", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-msg-block-"));
    enterPhaseCli(root, "GXPM-300", "implement");
    const msgFile = join(root, "COMMIT_EDITMSG");
    writeFileSync(msgFile, "fix: random change");

    const r = runCli(root, ["gate", "commit-msg", msgFile, "--issue", "GXPM-300"]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("missing-issue-ref");
  });

  test("allows message with GXPM-NNN", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-msg-ok-"));
    enterPhaseCli(root, "GXPM-301", "implement");
    const msgFile = join(root, "COMMIT_EDITMSG");
    writeFileSync(msgFile, "fix(api): work (GXPM-301)");

    const r = runCli(root, ["gate", "commit-msg", msgFile, "--issue", "GXPM-301"]);
    expect(r.exitCode).toBe(0);
  });
});

describe("gxpm gate brainstorm-skip CLI", () => {
  test("writes gate.brainstorm.skipped event with intake counts", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-brainstorm-skip-"));
    expect(runCli(root, ["issue", "create", "GXPM-601"]).exitCode).toBe(0);
    expect(runCli(root, [
      "artifact", "write", "GXPM-601", "issue-intake",
      "--json", JSON.stringify({
        acceptance: ["AC-1", "AC-2"],
        verified_pitfalls_to_avoid: ["avoid-1"],
      }),
    ]).exitCode).toBe(0);

    const r = runCli(root, [
      "gate", "brainstorm-skip", "GXPM-601",
      "--reason", "intake already exhaustive",
    ]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("gate.brainstorm.skipped");

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-601", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "gate.brainstorm.skipped",
      payload: {
        reason: "intake already exhaustive",
        ac_count: 2,
        anti_pattern_count: 1,
      },
    });
  });

  test("fails when brainstorm-skip is requested without issue-intake", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-brainstorm-no-intake-"));
    expect(runCli(root, ["issue", "create", "GXPM-602"]).exitCode).toBe(0);

    const r = runCli(root, [
      "gate", "brainstorm-skip", "GXPM-602",
      "--reason", "nothing to clarify",
    ]);

    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("issue-intake");
  });
});

describe("gxpm gate pre-push CLI", () => {
  test("blocks when required artifact missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-push-block-"));
    // enterPhase to dispatch leaves dispatch-handoff unwritten (it's the next-phase artifact)
    enterPhase(root, "GXPM-401", "dispatch");

    const r = runCli(root, ["gate", "pre-push", "GXPM-401"]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("missing-artifact");
  });

  test("allows when artifact present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-push-ok-"));
    enterPhase(root, "GXPM-402", "dispatch");
    // Explicitly initialize the dispatch-handoff artifact to satisfy the gate
    initializeDispatch({ root, issueId: "GXPM-402" });

    const r = runCli(root, ["gate", "pre-push", "GXPM-402"]);
    expect(r.exitCode).toBe(0);
  });
});

describe("gxpm gate post-merge CLI", () => {
  test("auto-transitions qa → land", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-merge-"));
    enterPhase(root, "GXPM-500", "qa");

    const r = runCli(root, ["gate", "post-merge", "GXPM-500"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("transitioned GXPM-500: qa -> land");
  });

  test("post-merge land transition runs post-land skill sync with install-skill all", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-merge-sync-"));
    const calls = join(root, "install-calls.txt");
    const fakeInit = join(root, "gxpm-init");
    writeFileSync(
      fakeInit,
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "${calls}"\n`,
    );
    chmodSync(fakeInit, 0o755);
    enterPhaseCli(root, "GXPM-502", "qa");

    const r = runCliWithEnv(root, ["gate", "post-merge", "GXPM-502"], {
      GXPM_INIT_BIN: fakeInit,
      GXPM_SKIP_POST_LAND_SYNC: "0",
    });

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("transitioned GXPM-502: qa -> land");
    expect(readFileSync(calls, "utf8").trim()).toBe("--install-skill --host all");
  });

  test("no-ops when phase=triage", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gate-merge-noop-"));
    enterPhase(root, "GXPM-501", "triage");

    const r = runCli(root, ["gate", "post-merge", "GXPM-501"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("not a merge-trigger phase");
  });
});
