import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../core/artifacts";
import { initializeLandFindings } from "../core/land";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { enterPhase, enterPhaseCli, output, runCli, runCliWithEnv } from "./helpers/workflow";

describe("land gate", () => {
  test("initializes land findings only in QA phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-init-"));
    createIssueState({ root, issueId: "GXPM-130" });

    expect(() => initializeLandFindings({ root, issueId: "GXPM-130" })).toThrow(
      "Land findings can only be initialized from qa phase",
    );

    enterPhase(root, "GXPM-131", "qa");
    const artifact = initializeLandFindings({ root, issueId: "GXPM-131" });

    expect(artifact.type).toBe("land-findings");
    expect(readArtifact({ root, issueId: "GXPM-131", type: "land-findings" }).payload).toEqual({
      landReady: false,
      mergePlan: "",
      qaFindingsArtifact: "qa-findings",
      releaseRisks: [],
      status: "draft",
      summary: "",
    });
  });

  test("blocks QA to land until land findings exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-gate-"));
    enterPhase(root, "GXPM-132", "qa");

    expect(() => transitionIssuePhase({ root, issueId: "GXPM-132", nextPhase: "land" })).toThrow(
      "Missing required artifact",
    );
    const blockedEvents = readFileSync(join(root, ".gxpm", "issues", "GXPM-132", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blockedEvents.at(-1)).toMatchObject({
      type: "gate.blocked",
      payload: { missingArtifact: "land-findings" },
    });

    initializeLandFindings({ root, issueId: "GXPM-132" });
    const state = transitionIssuePhase({ root, issueId: "GXPM-132", nextPhase: "land" });

    expect(state.currentPhase).toBe("land");
    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-132", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      type: "gate.passed",
      payload: { requiredArtifact: "land-findings" },
    });
  });

  // Heavy test: spawns multiple CLI subprocesses and walks the full
  // triage→qa flow via enterPhaseCli. The default 5s timeout is too tight
  // under full-suite parallel load; raise to 30s.
  test("CLI supports land findings init and artifact-backed land transition", { timeout: 30000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-cli-"));
    enterPhaseCli(root, "GXPM-133", "qa");

    const blocked = runCli(root, ["issue", "transition", "GXPM-133", "land"]);
    expect(blocked.exitCode).toBe(1);
    expect(output(blocked)).toContain("Missing required artifact");
    expect(output(blocked)).toContain("gxpm qa land GXPM-133");

    const land = runCli(root, ["qa", "land", "GXPM-133"]);
    expect(land.exitCode).toBe(0);
    expect(output(land)).toContain("initialized land findings artifact for GXPM-133");

    const list = runCli(root, ["artifact", "list", "GXPM-133"]);
    expect(list.exitCode).toBe(0);
    expect(output(list)).toContain("qa-findings");
    expect(output(list)).toContain("land-findings");

    const read = runCli(root, ["artifact", "read", "GXPM-133", "land-findings"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain('"status": "draft"');

    const transition = runCli(root, ["issue", "transition", "GXPM-133", "land"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-133: qa -> land");
  });

  // Heavy test: walks the full triage→qa flow then spawns the land
  // transition CLI; default 5s timeout is too tight under full-suite load.
  test("CLI land transition runs post-land skill sync with install-skill all", { timeout: 30000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-sync-"));
    const calls = join(root, "install-calls.txt");
    const fakeInit = join(root, "gxpm-init");
    writeFileSync(
      fakeInit,
      `#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"${calls}\"\n`,
    );
    chmodSync(fakeInit, 0o755);
    enterPhaseCli(root, "GXPM-134", "qa");
    expect(runCli(root, ["qa", "land", "GXPM-134"]).exitCode).toBe(0);

    const transition = runCliWithEnv(root, ["issue", "transition", "GXPM-134", "land"], {
      GXPM_INIT_BIN: fakeInit,
      GXPM_SKIP_POST_LAND_SYNC: "0",
    });

    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-134: qa -> land");
    expect(readFileSync(calls, "utf8").trim()).toBe("--install-skill --host all");
  });

  test("CLI non-land transition does not run post-land skill sync", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-non-land-sync-"));
    const calls = join(root, "install-calls.txt");
    const fakeInit = join(root, "gxpm-init");
    writeFileSync(
      fakeInit,
      `#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"${calls}\"\n`,
    );
    chmodSync(fakeInit, 0o755);
    expect(runCli(root, ["issue", "create", "GXPM-135"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-135"]).exitCode).toBe(0);

    const transition = runCliWithEnv(root, ["issue", "transition", "GXPM-135", "plan"], {
      GXPM_INIT_BIN: fakeInit,
      GXPM_SKIP_POST_LAND_SYNC: "0",
    });

    expect(transition.exitCode).toBe(0);
    expect(existsSync(calls)).toBe(false);
  });

  // Heavy test: walks the full triage→qa flow then spawns the land
  // transition CLI; default 5s timeout is too tight under full-suite load.
  test("post-land skill sync failure logs but does not block transition", { timeout: 30000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-land-sync-fail-"));
    const fakeInit = join(root, "gxpm-init");
    writeFileSync(fakeInit, "#!/bin/bash\necho install failed >&2\nexit 42\n");
    chmodSync(fakeInit, 0o755);
    enterPhaseCli(root, "GXPM-136", "qa");
    expect(runCli(root, ["qa", "land", "GXPM-136"]).exitCode).toBe(0);

    const transition = runCliWithEnv(root, ["issue", "transition", "GXPM-136", "land"], {
      GXPM_INIT_BIN: fakeInit,
      GXPM_SKIP_POST_LAND_SYNC: "0",
    });

    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-136: qa -> land");
    expect(output(transition)).toContain("[gxpm land sync] post-land skill install failed: install failed");
  });
});
