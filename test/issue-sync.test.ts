import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueState,
  readIssueState,
  transitionIssuePhase,
  setIssueArchived,
} from "../core/state";
import { writeArtifact } from "../core/artifacts";
import {
  readSyncState,
  writeSyncState,
  resolveSyncProvider,
  maybeSyncIssue,
} from "../core/issue-sync";

const SYNC_ENV_KEYS = [
  "GXPM_SYNC_PROVIDER",
  "GXPM_AUTO_SYNC",
  "GXPM_SYNC_ARTIFACTS",
  "GXPM_LINEAR_TEAM_ID",
  "GXPM_LINEAR_TEAM_KEY",
  "GXPM_LINEAR_ASSIGNEE_ID",
  "GXPM_TEST_ALLOW_LIVE_SYNC",
] as const;

// Fake Linear CLI that reads responses from a JSON file.
// The test writes responses to a file, then the fake CLI matches commands against them.
function setupFakeLinearCLI(): { binDir: string; logFile: string; responsesFile: string } {
  const binDir = mkdtempSync(join(tmpdir(), "gxpm-fake-linear-"));
  const logFile = join(binDir, "calls.jsonl");
  const responsesFile = join(binDir, "responses.json");

  // Initialize empty files
  writeFileSync(logFile, "");
  writeFileSync(responsesFile, JSON.stringify([]));

  const scriptPath = join(binDir, "linear");
  const jsPath = join(binDir, "linear.js");

  const jsCode = `
const fs = require("fs");
const responsesFile = process.env.GXPM_TEST_LINEAR_RESPONSES;
const logFile = process.env.GXPM_TEST_LINEAR_LOG;
const args = process.argv.slice(2);
const cmd = args.join(" ");

// Log the call
if (logFile) {
  fs.appendFileSync(logFile, JSON.stringify({ cmd, args }) + "\\n");
}

// Load responses
let responses = [];
try {
  responses = JSON.parse(fs.readFileSync(responsesFile, "utf8"));
} catch {}

// Find matching response
for (const r of responses) {
  if (r.matcher && typeof r.matcher === "string") {
    // Simple substring match
    if (cmd.includes(r.matcher)) {
      process.stdout.write(r.output);
      process.exit(r.exitCode ?? 0);
    }
  } else if (r.matchArgs) {
    // Match specific args
    const allMatch = r.matchArgs.every((expected, i) => args[i] === expected);
    if (allMatch && args.length >= r.matchArgs.length) {
      process.stdout.write(r.output);
      process.exit(r.exitCode ?? 0);
    }
  }
}

// Default fallback
process.stdout.write('{}');
process.exit(0);
`;
  writeFileSync(jsPath, jsCode);

  const shellScript = `#!/bin/bash
node "${jsPath}" "$@"
`;
  writeFileSync(scriptPath, shellScript);
  chmodSync(scriptPath, 0o755);

  return { binDir, logFile, responsesFile };
}

function setFakeResponses(responsesFile: string, responses: Array<{ matcher?: string; matchArgs?: string[]; output: string; exitCode?: number }>) {
  writeFileSync(responsesFile, JSON.stringify(responses));
}

function readCallLog(logFile: string): Array<{ cmd: string; args: string[] }> {
  const raw = readFileSync(logFile, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

describe("issue sync", () => {
  let originalPath: string | undefined;
  let originalGxpmHome: string | undefined;
  let originalResponsesEnv: string | undefined;
  let originalLogEnv: string | undefined;
  let originalSyncEnv: Record<(typeof SYNC_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalGxpmHome = process.env.GXPM_HOME;
    originalResponsesEnv = process.env.GXPM_TEST_LINEAR_RESPONSES;
    originalLogEnv = process.env.GXPM_TEST_LINEAR_LOG;
    originalSyncEnv = Object.fromEntries(
      SYNC_ENV_KEYS.map((key) => [key, process.env[key]]),
    ) as Record<(typeof SYNC_ENV_KEYS)[number], string | undefined>;
  });

  afterEach(() => {
    if (originalPath !== undefined) {
      process.env.PATH = originalPath;
    }
    if (originalGxpmHome !== undefined) {
      process.env.GXPM_HOME = originalGxpmHome;
    } else {
      delete process.env.GXPM_HOME;
    }
    if (originalResponsesEnv !== undefined) {
      process.env.GXPM_TEST_LINEAR_RESPONSES = originalResponsesEnv;
    } else {
      delete process.env.GXPM_TEST_LINEAR_RESPONSES;
    }
    if (originalLogEnv !== undefined) {
      process.env.GXPM_TEST_LINEAR_LOG = originalLogEnv;
    } else {
      delete process.env.GXPM_TEST_LINEAR_LOG;
    }
    for (const key of SYNC_ENV_KEYS) {
      const value = originalSyncEnv[key];
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  test("resolveSyncProvider returns null when linear CLI is not available", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-none-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(join(root, ".gxpm", "config.json"), JSON.stringify({}));
    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("resolveSyncProvider returns null when autoSync is disabled", () => {
    const { binDir } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-disabled-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", autoSync: false } }),
    );
    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("resolveSyncProvider returns linear provider when CLI and teamKey are configured", () => {
    const { binDir } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-config-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    const provider = resolveSyncProvider(root);
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("linear");
  });

  test("resolveSyncProvider returns null when linearTeamKey is missing", () => {
    const { binDir } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-no-team-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear" } }),
    );

    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("resolveSyncProvider ignores env and global sync config during tests", () => {
    const { binDir } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_SYNC_PROVIDER = "linear";
    process.env.GXPM_LINEAR_TEAM_KEY = "ENG";
    process.env.GXPM_AUTO_SYNC = "true";
    delete process.env.GXPM_TEST_ALLOW_LIVE_SYNC;

    const home = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    process.env.GXPM_HOME = home;
    mkdirSync(join(home, ".gxpm"), { recursive: true });
    writeFileSync(
      join(home, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-test-isolated-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(join(root, ".gxpm", "config.json"), JSON.stringify({}));

    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("readSyncState returns empty state when file does not exist", () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-read-"));
    const state = readSyncState({ root, issueId: "GXPM-SYNC-1" });
    expect(state.schemaVersion).toBe(1);
    expect(state.targets).toHaveLength(0);
  });

  test("writeSyncState persists sync data", () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-write-"));
    const state = {
      schemaVersion: 1,
      issueId: "GXPM-SYNC-2",
      targets: [
        {
          provider: "linear" as const,
          externalId: "ext-123",
          displayId: "ENG-1",
          url: "https://linear.app/issue/ENG-1",
        },
      ],
    };
    writeSyncState({ root, issueId: "GXPM-SYNC-2", state });
    const read = readSyncState({ root, issueId: "GXPM-SYNC-2" });
    expect(read.targets).toHaveLength(1);
    expect(read.targets[0].displayId).toBe("ENG-1");
  });

  test("createIssueState triggers sync when Linear CLI is configured", async () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const { binDir, logFile, responsesFile } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_TEST_LINEAR_RESPONSES = responsesFile;
    process.env.GXPM_TEST_LINEAR_LOG = logFile;

    setFakeResponses(responsesFile, [
      { matcher: "--version", output: "3.1.0\n", exitCode: 0 },
      { matcher: "label create", output: "✓ Created label\n", exitCode: 0 },
      {
        matcher: "issue create",
        output: JSON.stringify({
          id: "lin-1",
          identifier: "ENG-99",
          url: "https://linear.app/ENG-99",
          success: true,
        }),
        exitCode: 0,
      },
    ]);

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-create-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    createIssueState({ root, issueId: "GXPM-SYNC-3" });

    // Wait for async sync
    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-3" });
    expect(syncState.targets).toHaveLength(1);
    expect(syncState.targets[0].provider).toBe("linear");
    expect(syncState.targets[0].displayId).toBe("ENG-99");

    const calls = readCallLog(logFile);
    const createCalls = calls.filter((c) => c.cmd.includes("issue create"));
    expect(createCalls.length).toBe(1);
  });

  test("transitionIssuePhase triggers sync update via linear CLI move", async () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const { binDir, logFile, responsesFile } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_TEST_LINEAR_RESPONSES = responsesFile;
    process.env.GXPM_TEST_LINEAR_LOG = logFile;

    setFakeResponses(responsesFile, [
      { matcher: "--version", output: "3.1.0\n", exitCode: 0 },
      { matcher: "label create", output: "✓ Created label\n", exitCode: 0 },
      {
        matcher: "issue create",
        output: JSON.stringify({
          id: "lin-2",
          identifier: "ENG-2",
          url: "https://linear.app/ENG-2",
          success: true,
        }),
        exitCode: 0,
      },
      {
        matcher: "issue move",
        output: JSON.stringify({ identifier: "ENG-2", state: "Backlog" }),
        exitCode: 0,
      },
    ]);

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-transition-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    createIssueState({ root, issueId: "GXPM-SYNC-4" });
    await new Promise((r) => setTimeout(r, 100));

    // Pre-create the required artifact for transition
    writeArtifact({ root, issueId: "GXPM-SYNC-4", type: "acceptance-contract", payload: { criteria: [] } });

    transitionIssuePhase({ root, issueId: "GXPM-SYNC-4", nextPhase: "plan" });
    await new Promise((r) => setTimeout(r, 100));

    const calls = readCallLog(logFile);
    const moveCalls = calls.filter((c) => c.cmd.includes("issue move"));
    expect(moveCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("setIssueArchived triggers sync archive via linear CLI move", async () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const { binDir, logFile, responsesFile } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_TEST_LINEAR_RESPONSES = responsesFile;
    process.env.GXPM_TEST_LINEAR_LOG = logFile;

    setFakeResponses(responsesFile, [
      { matcher: "--version", output: "3.1.0\n", exitCode: 0 },
      { matcher: "label create", output: "✓ Created label\n", exitCode: 0 },
      {
        matcher: "issue create",
        output: JSON.stringify({
          id: "lin-3",
          identifier: "ENG-3",
          url: "https://linear.app/ENG-3",
          success: true,
        }),
        exitCode: 0,
      },
      {
        matcher: "issue move",
        output: JSON.stringify({ identifier: "ENG-3", state: "Canceled" }),
        exitCode: 0,
      },
    ]);

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-archive-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    createIssueState({ root, issueId: "GXPM-SYNC-5" });
    await new Promise((r) => setTimeout(r, 100));

    setIssueArchived({ root, issueId: "GXPM-SYNC-5", archived: true });
    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-5" });
    expect(syncState.targets[0].lastError).toBeUndefined();

    const calls = readCallLog(logFile);
    const moveCalls = calls.filter((c) => c.cmd.includes("issue move") && c.cmd.includes("canceled"));
    expect(moveCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("sync failure is silently recorded without blocking local ops", async () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const { binDir, logFile, responsesFile } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_TEST_LINEAR_RESPONSES = responsesFile;
    process.env.GXPM_TEST_LINEAR_LOG = logFile;

    setFakeResponses(responsesFile, [
      { matcher: "--version", output: "3.1.0\n", exitCode: 0 },
      { matcher: "label create", output: "✓ Created label\n", exitCode: 0 },
      {
        matcher: "issue create",
        output: "error",
        exitCode: 1,
      },
    ]);

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-fail-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    const state = createIssueState({ root, issueId: "GXPM-SYNC-6" });
    expect(state.issueId).toBe("GXPM-SYNC-6");

    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-6" });
    // Since creation failed, no target should be linked yet
    expect(syncState.targets).toHaveLength(0);
  });

  test("createIssue includes repo label and description with repo info", async () => {
    process.env.GXPM_HOME = mkdtempSync(join(tmpdir(), "gxpm-home-"));
    const { binDir, logFile, responsesFile } = setupFakeLinearCLI();
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.GXPM_TEST_LINEAR_RESPONSES = responsesFile;
    process.env.GXPM_TEST_LINEAR_LOG = logFile;

    setFakeResponses(responsesFile, [
      { matcher: "--version", output: "3.1.0\n", exitCode: 0 },
      { matcher: "label create", output: "✓ Created label\n", exitCode: 0 },
      {
        matcher: "issue create",
        output: JSON.stringify({
          id: "lin-7",
          identifier: "ENG-7",
          url: "https://linear.app/ENG-7",
          success: true,
        }),
        exitCode: 0,
      },
    ]);

    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-repo-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamKey: "ENG" } }),
    );

    createIssueState({ root, issueId: "GXPM-SYNC-7" });
    await new Promise((r) => setTimeout(r, 100));

    const calls = readCallLog(logFile);
    const createCall = calls.find((c) => c.cmd.includes("issue create"));
    expect(createCall).toBeDefined();
    expect(createCall!.cmd).toContain("--label");
    expect(createCall!.cmd).toContain("repo:");
    expect(createCall!.cmd).toContain("--description-file");

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-7" });
    expect(syncState.targets).toHaveLength(1);
    expect(syncState.targets[0].displayId).toBe("ENG-7");
  });
});
