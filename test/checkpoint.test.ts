import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIssueCheckpoint, readResumePacket } from "../core/checkpoint";
import { createIssueState, transitionIssuePhase } from "../core/state";
import { writeArtifact } from "../core/artifacts";

describe("issue checkpoint store", () => {
  test("writes an append-only markdown checkpoint and immutable resume packet", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-"));
    createIssueState({ root, issueId: "GXPM-60" });
    writeArtifact({
      root,
      issueId: "GXPM-60",
      type: "acceptance-contract",
      payload: { criteria: [] },
    });
    transitionIssuePhase({ root, issueId: "GXPM-60", nextPhase: "plan" });

    const result = writeIssueCheckpoint({
      root,
      issueId: "GXPM-60",
      title: "Clean Context!",
      branch: "gxpm-60-checkpoint",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: {
        summary: "Persist the issue handoff so a fresh session can resume.",
        decisions: ["Use .gxpm issue memory as the source of truth."],
        remainingWork: ["Implement CLI resume output."],
        notes: ["Do not depend on gstack runtime."],
        filesModified: ["core/checkpoint.ts"],
      },
    });

    expect(result.path).toBe("memory/checkpoints/20260427-044500-clean-context.md");
    expect(result.resumePacketPath).toBe("memory/resume-packets/20260427-044500-clean-context.json");

    const checkpointPath = join(root, ".gxpm", "issues", "GXPM-60", result.path);
    expect(existsSync(checkpointPath)).toBe(true);
    expect(readFileSync(checkpointPath, "utf8")).toContain("## Working on: Clean Context!");

    const packet = readResumePacket({ root, issueId: "GXPM-60" });
    expect(packet).toMatchObject({
      issueId: "GXPM-60",
      phase: "plan",
      title: "Clean Context!",
      branch: "gxpm-60-checkpoint",
      checkpointPath: result.path,
      summary: "Persist the issue handoff so a fresh session can resume.",
      remainingWork: ["Implement CLI resume output."],
    });

    const latestIndex = JSON.parse(
      readFileSync(join(root, ".gxpm", "issues", "GXPM-60", "memory", "latest-resume-packet.json"), "utf8"),
    );
    expect(latestIndex.path).toBe(result.resumePacketPath);

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-60", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "checkpoint.written",
      payload: { checkpointPath: result.path, resumePacketPath: result.resumePacketPath },
    });
  });

  test("does not overwrite an existing checkpoint with the same timestamp and title", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-collision-"));
    createIssueState({ root, issueId: "GXPM-61" });
    const now = new Date("2026-04-27T04:45:00.000Z");

    const first = writeIssueCheckpoint({
      root,
      issueId: "GXPM-61",
      title: "Same Title",
      now,
      payload: { summary: "first" },
    });
    const second = writeIssueCheckpoint({
      root,
      issueId: "GXPM-61",
      title: "Same Title",
      now,
      payload: { summary: "second" },
    });

    expect(first.path).toBe("memory/checkpoints/20260427-044500-same-title.md");
    expect(second.path).toBe("memory/checkpoints/20260427-044500-same-title-2.md");
    expect(readResumePacket({ root, issueId: "GXPM-61" }).summary).toBe("second");
    expect(readFileSync(join(root, ".gxpm", "issues", "GXPM-61", first.path), "utf8")).toContain(
      "first",
    );
  });

  test("renders empty files_modified frontmatter as an inline array", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-empty-files-"));
    createIssueState({ root, issueId: "GXPM-62" });

    const result = writeIssueCheckpoint({
      root,
      issueId: "GXPM-62",
      title: "No Files",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: { summary: "checkpoint without modified files" },
    });

    const markdown = readFileSync(join(root, ".gxpm", "issues", "GXPM-62", result.path), "utf8");
    expect(markdown).toContain("files_modified: []");
    expect(markdown).not.toContain("files_modified:\n  []");
  });

  test("quotes YAML frontmatter scalars with special characters", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-yaml-"));
    createIssueState({ root, issueId: "GXPM-63" });

    const result = writeIssueCheckpoint({
      root,
      issueId: "GXPM-63",
      title: "Quoted YAML",
      branch: "feature: checkpoint #1",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: {
        status: "needs: review #1",
        summary: "checkpoint with YAML-sensitive frontmatter",
        filesModified: ["docs/notes: draft #1.md", "line\nbreak.ts"],
      },
    });

    const markdown = readFileSync(join(root, ".gxpm", "issues", "GXPM-63", result.path), "utf8");
    expect(markdown).toContain('status: "needs: review #1"');
    expect(markdown).toContain('branch: "feature: checkpoint #1"');
    expect(markdown).toContain('checkpointPath: "memory/checkpoints/20260427-044500-quoted-yaml.md"');
    expect(markdown).toContain('  - "docs/notes: draft #1.md"');
    expect(markdown).toContain('  - "line\\nbreak.ts"');
  });

  test("immutable resume packets append rather than overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-immutable-"));
    createIssueState({ root, issueId: "GXPM-64" });
    const now = new Date("2026-04-27T04:45:00.000Z");

    const first = writeIssueCheckpoint({
      root,
      issueId: "GXPM-64",
      title: "First",
      now,
      payload: { summary: "first checkpoint" },
    });
    const second = writeIssueCheckpoint({
      root,
      issueId: "GXPM-64",
      title: "Second",
      now: new Date(now.getTime() + 1000),
      payload: { summary: "second checkpoint" },
    });

    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-64", first.resumePacketPath))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-64", second.resumePacketPath))).toBe(true);
    expect(readResumePacket({ root, issueId: "GXPM-64" }).summary).toBe("second checkpoint");
  });

  test("links parentCheckpointId to previous resume packet", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-parent-"));
    createIssueState({ root, issueId: "GXPM-65" });

    const first = writeIssueCheckpoint({
      root,
      issueId: "GXPM-65",
      title: "First",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: { summary: "first" },
    });

    const second = writeIssueCheckpoint({
      root,
      issueId: "GXPM-65",
      title: "Second",
      now: new Date("2026-04-27T04:45:01.000Z"),
      payload: { summary: "second" },
    });

    const packet = readResumePacket({ root, issueId: "GXPM-65" });
    expect(packet.parentCheckpointId).toBe(first.resumePacketPath);
    expect(packet.summary).toBe("second");

    const firstPacket = JSON.parse(
      readFileSync(join(root, ".gxpm", "issues", "GXPM-65", first.resumePacketPath), "utf8"),
    );
    expect(firstPacket.parentCheckpointId).toBeUndefined();
  });

  test("preserves transitionReason in resume packet and event", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-reason-"));
    createIssueState({ root, issueId: "GXPM-66" });

    const result = writeIssueCheckpoint({
      root,
      issueId: "GXPM-66",
      title: "Handoff",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: { summary: "handing off", transitionReason: "phase-complete" },
    });

    const packet = readResumePacket({ root, issueId: "GXPM-66" });
    expect(packet.transitionReason).toBe("phase-complete");

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-66", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "checkpoint.written",
      payload: {
        checkpointPath: result.path,
        resumePacketPath: result.resumePacketPath,
        transitionReason: "phase-complete",
      },
    });
  });

  test("reads old single-file resume-packet.json for backward compatibility", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-compat-"));
    createIssueState({ root, issueId: "GXPM-67" });

    const oldPacket = {
      schemaVersion: 1,
      issueId: "GXPM-67",
      phase: "triage",
      title: "Legacy",
      status: "in-progress",
      branch: "main",
      writtenAt: new Date().toISOString(),
      checkpointPath: "memory/checkpoints/legacy.md",
      summary: "legacy packet",
      decisions: [],
      remainingWork: [],
      notes: [],
      filesModified: [],
    };

    const paths = join(root, ".gxpm", "issues", "GXPM-67");
    writeFileSync(join(paths, "memory", "resume-packet.json"), `${JSON.stringify(oldPacket, null, 2)}\n`);

    const packet = readResumePacket({ root, issueId: "GXPM-67" });
    expect(packet.summary).toBe("legacy packet");
    expect(packet.title).toBe("Legacy");
  });

  test("links parent to old resume-packet.json when transitioning from legacy", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-checkpoint-compat-parent-"));
    createIssueState({ root, issueId: "GXPM-68" });

    const oldPacket = {
      schemaVersion: 1,
      issueId: "GXPM-68",
      phase: "triage",
      title: "Legacy",
      status: "in-progress",
      branch: "main",
      writtenAt: new Date().toISOString(),
      checkpointPath: "memory/checkpoints/legacy.md",
      summary: "legacy packet",
      decisions: [],
      remainingWork: [],
      notes: [],
      filesModified: [],
    };

    const paths = join(root, ".gxpm", "issues", "GXPM-68");
    writeFileSync(join(paths, "memory", "resume-packet.json"), `${JSON.stringify(oldPacket, null, 2)}\n`);

    const result = writeIssueCheckpoint({
      root,
      issueId: "GXPM-68",
      title: "New",
      now: new Date("2026-04-27T04:45:00.000Z"),
      payload: { summary: "new checkpoint after legacy" },
    });

    const packet = readResumePacket({ root, issueId: "GXPM-68" });
    expect(packet.parentCheckpointId).toBe("memory/resume-packet.json");
    expect(packet.summary).toBe("new checkpoint after legacy");
    expect(result.resumePacketPath.startsWith("memory/resume-packets/")).toBe(true);
  });
});
