import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArtifacts, readArtifact, writeArtifact } from "../core/artifacts";
import { transitionIssuePhase } from "../core/state";
import { enterPhase, output, runCli } from "./helpers/workflow";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("post-merge land-findings reconciliation", () => {
  test("rewrites land-findings after a real merge", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-ok-"));
    const sha = initGitCommit(root);
    enterLandWithFindings(root, "GXPM-600", {
      landReady: false,
      mergePlan: "merge after user approval",
      releaseRisks: ["manual approval pending"],
      status: "pending-user-confirmation",
      summary: "Ready for user merge.",
    });

    const result = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-600",
      "--sha", sha,
    ]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("reconciled land-findings");

    const artifact = readArtifact({ root, issueId: "GXPM-600", type: "land-findings" });
    const payload = artifact.payload as Record<string, unknown>;
    expect(payload.status).toBe("landed");
    expect(payload.mergedSha).toBe(sha);
    expect(typeof payload.mergedAt).toBe("string");
    expect(payload.landReady).toBe(false);
    expect(payload.mergePlan).toBe("merge after user approval");
    expect(payload.releaseRisks).toEqual(["manual approval pending"]);

    const record = listArtifacts({ root, issueId: "GXPM-600" }).find(
      (item) => item.type === "land-findings",
    );
    expect(record?.writtenAt).toBe(artifact.writtenAt);

    const reconciledEvents = readEvents(root, "GXPM-600").filter(
      (event) => event.type === "artifact.reconciled",
    );
    expect(reconciledEvents).toHaveLength(1);
    expect(reconciledEvents[0]?.payload).toMatchObject({
      artifactType: "land-findings",
      mergedSha: sha,
      path: "artifacts/land-findings.json",
    });
  });

  test("does not duplicate reconciliation events for the same sha", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-idempotent-"));
    const sha = initGitCommit(root);
    enterLandWithFindings(root, "GXPM-601", {
      status: "pending-user-confirmation",
      summary: "Ready for user merge.",
    });

    const first = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-601",
      "--sha", sha,
    ]);
    expect(first.exitCode).toBe(0);
    const firstArtifact = readArtifact({ root, issueId: "GXPM-601", type: "land-findings" });

    const second = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-601",
      "--sha", sha,
    ]);

    expect(second.exitCode).toBe(0);
    expect(output(second)).toContain("already reconciled");
    const secondArtifact = readArtifact({ root, issueId: "GXPM-601", type: "land-findings" });
    expect(secondArtifact.writtenAt).toBe(firstArtifact.writtenAt);
    expect(readEvents(root, "GXPM-601").filter((event) => event.type === "artifact.reconciled")).toHaveLength(1);
  });

  test("silently no-ops when land-findings is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-missing-"));
    enterLandWithFindings(root, "GXPM-602", {
      status: "pending-user-confirmation",
    });
    unlinkSync(join(root, ".gxpm", "issues", "GXPM-602", "artifacts", "land-findings.json"));

    const result = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-602",
      "--sha", SHA_A,
    ]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("land-findings artifact missing");
    expect(readEvents(root, "GXPM-602").filter((event) => event.type === "artifact.reconciled")).toHaveLength(0);
  });

  test("silently no-ops when current phase is not land", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-wrong-phase-"));
    enterPhase(root, "GXPM-603", "qa");
    writeArtifact({
      root,
      issueId: "GXPM-603",
      type: "land-findings",
      payload: { status: "pending-user-confirmation" },
    });

    const result = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-603",
      "--sha", SHA_A,
    ]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("phase=qa is not land");
    const artifact = readArtifact({ root, issueId: "GXPM-603", type: "land-findings" });
    expect((artifact.payload as Record<string, unknown>).status).toBe("pending-user-confirmation");
    expect(readEvents(root, "GXPM-603").filter((event) => event.type === "artifact.reconciled")).toHaveLength(0);
  });

  test("reconciles legacy payloads that lack merged fields", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-legacy-"));
    const sha = initGitCommit(root);
    enterLandWithFindings(root, "GXPM-604", {
      summary: "Legacy land artifact.",
    });

    const result = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-604",
      "--sha", sha,
    ]);

    expect(result.exitCode).toBe(0);
    const artifact = readArtifact({ root, issueId: "GXPM-604", type: "land-findings" });
    expect(artifact.payload).toMatchObject({
      summary: "Legacy land artifact.",
      status: "landed",
      mergedSha: sha,
    });
    expect(typeof (artifact.payload as Record<string, unknown>).mergedAt).toBe("string");
  });

  test("rejects a sha that is not a commit in the current repo before rewriting", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-reconcile-unknown-sha-"));
    initGitCommit(root);
    enterLandWithFindings(root, "GXPM-605", {
      status: "pending-user-confirmation",
      summary: "Ready for user merge.",
    });

    const result = runCli(root, [
      "gate", "post-merge-reconcile", "GXPM-605",
      "--sha", SHA_B,
    ]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("Git commit not found for post-merge reconcile");
    const artifact = readArtifact({ root, issueId: "GXPM-605", type: "land-findings" });
    expect((artifact.payload as Record<string, unknown>).status).toBe("pending-user-confirmation");
    expect(readEvents(root, "GXPM-605").filter((event) => event.type === "artifact.reconciled")).toHaveLength(0);
  });
});

function enterLandWithFindings(root: string, issueId: string, payload: Record<string, unknown>) {
  enterPhase(root, issueId, "qa");
  writeArtifact({ root, issueId, type: "land-findings", payload });
  transitionIssuePhase({ root, issueId, nextPhase: "land" });
}

function readEvents(root: string, issueId: string): Array<{
  type: string;
  payload: Record<string, unknown>;
}> {
  const eventsPath = join(root, ".gxpm", "issues", issueId, "events.jsonl");
  if (!existsSync(eventsPath)) return [];
  const raw = readFileSync(eventsPath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

function initGitCommit(root: string) {
  execSync("git init -q", { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  execSync("git add tracked.txt", { cwd: root });
  execSync(
    "git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name='gxpm test' -c user.email='gxpm@example.test' commit -q -m initial",
    { cwd: root },
  );
  return execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
}
