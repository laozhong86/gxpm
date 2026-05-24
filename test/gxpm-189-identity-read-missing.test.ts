import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "../core/artifacts";
import { resolveSessionId } from "../core/session";
import { appendIssueEvent, getIssuePaths } from "../core/state";
import { enterPhase } from "./helpers/workflow";

// Feature: GXPM-189 PR-1 identity-read-missing telemetry middleware
//
// Every artifact write checks whether the current sessionId has previously
// emitted issue.context.read or worktree.identity.read for the same issue.
// If not, the write proceeds (telemetry-only, never blocks) and appends an
// identity.read.missing event. PR-2 will gate writes via GXPM_IDENTITY_GATE
// when strict mode lands.

describe("GXPM-189 identity-read-missing middleware (PR-1 telemetry)", () => {
  test("scn-01: artifact write without prior identity-read appends identity.read.missing", () => {
    const repo = setupIssueRepo("GXPM-980");

    writeArtifact({
      root: repo,
      issueId: "GXPM-980",
      type: "acceptance-contract",
      payload: { criteria: [], status: "draft", notes: "test" },
    });

    const events = readEvents(repo, "GXPM-980");
    const missing = events.filter((e) => e.type === "identity.read.missing");
    expect(missing.length).toBe(1);
    const payload = missing[0].payload as Record<string, unknown>;
    expect(typeof payload.phase).toBe("string");
    expect(payload.artifactType).toBe("acceptance-contract");
    expect(typeof payload.cwd).toBe("string");
  });

  test("scn-02: prior issue.context.read for same session suppresses identity.read.missing", () => {
    const repo = setupIssueRepo("GXPM-981");
    const paths = getIssuePaths(repo, "GXPM-981");
    // Emit identity-read event for the current sessionId.
    appendIssueEvent({
      issueDir: paths.issueDir,
      event: {
        schemaVersion: 1,
        type: "issue.context.read",
        issueId: "GXPM-981",
        timestamp: new Date().toISOString(),
        sessionId: resolveSessionId(),
        payload: {},
      },
    });

    writeArtifact({
      root: repo,
      issueId: "GXPM-981",
      type: "acceptance-contract",
      payload: { criteria: [], status: "draft" },
    });

    const events = readEvents(repo, "GXPM-981");
    expect(events.some((e) => e.type === "identity.read.missing")).toBe(false);
  });

  test("scn-03: feedback-description artifact is exempt from identity check", () => {
    const repo = setupIssueRepo("GXPM-982");

    writeArtifact({
      root: repo,
      issueId: "GXPM-982",
      type: "feedback-description",
      payload: { description: "test" },
    });

    const events = readEvents(repo, "GXPM-982");
    expect(events.some((e) => e.type === "identity.read.missing")).toBe(false);
  });

  test("scn-04: warn-only — write succeeds and other behavior is preserved", () => {
    const repo = setupIssueRepo("GXPM-983");

    const record = writeArtifact({
      root: repo,
      issueId: "GXPM-983",
      type: "acceptance-contract",
      payload: { criteria: [], status: "draft" },
    });

    expect(record.type).toBe("acceptance-contract");
    expect(record.path).toBe("artifacts/acceptance-contract.json");
    // Artifact file actually written:
    expect(
      readFileSync(
        join(repo, ".gxpm/issues/GXPM-983/artifacts/acceptance-contract.json"),
        "utf8",
      ),
    ).toContain("acceptance-contract");
  });
});

function setupIssueRepo(issueId: string): string {
  const repo = mkdtempSync(join(tmpdir(), `gxpm-189-${issueId}-`));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "t@t.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  writeFileSync(join(repo, "README.md"), "init");
  execSync("git add README.md", { cwd: repo });
  execSync('git commit -m "init"', { cwd: repo });
  enterPhase(repo, issueId, "triage");
  return repo;
}

function readEvents(repo: string, issueId: string): Array<{ type: string; payload?: unknown }> {
  const eventsPath = join(repo, ".gxpm/issues", issueId, "events.jsonl");
  return readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
