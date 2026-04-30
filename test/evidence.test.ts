import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import {
  evidenceFilename,
  prepareIssueEvidencePath,
  writeIssueEvidenceBytes,
  writeIssueEvidenceJson,
  writeIssueEvidenceText,
} from "../core/evidence";

function makeIssueRoot(issueId = "GXPM-EVIDENCE") {
  const root = mkdtempSync(join(tmpdir(), "gxpm-evidence-root-"));
  createIssueState({ root, issueId });
  return { root, issueId };
}

describe("issue evidence store", () => {
  test("writes json, text, and bytes under the issue evidence tree", () => {
    const { root, issueId } = makeIssueRoot();
    const timestamp = new Date("2026-04-30T11:30:00.000Z");

    const json = writeIssueEvidenceJson({
      root,
      issueId,
      kind: "investigations",
      filename: evidenceFilename("investigation", "json", timestamp),
      payload: { status: "complete" },
    });
    const text = writeIssueEvidenceText({
      root,
      issueId,
      kind: "command-logs",
      filename: evidenceFilename("command", "txt", timestamp),
      text: "bun test\n",
    });
    const bytes = writeIssueEvidenceBytes({
      root,
      issueId,
      kind: "browser-screenshots",
      filename: evidenceFilename("screenshot", "png", timestamp),
      bytes: new TextEncoder().encode("fake-png"),
      mediaType: "image/png",
    });

    expect(json.path).toBe("evidence/investigations/investigation-2026-04-30T11-30-00-000Z.json");
    expect(text.path).toBe("evidence/command-logs/command-2026-04-30T11-30-00-000Z.txt");
    expect(bytes.path).toBe("evidence/browser-screenshots/screenshot-2026-04-30T11-30-00-000Z.png");
    expect(json.mediaType).toBe("application/json");
    expect(bytes.mediaType).toBe("image/png");
    expect(JSON.parse(readFileSync(join(root, ".gxpm", "issues", issueId, json.path), "utf8"))).toEqual({
      status: "complete",
    });
    expect(readFileSync(join(root, ".gxpm", "issues", issueId, text.path), "utf8")).toBe("bun test\n");
    expect(readFileSync(join(root, ".gxpm", "issues", issueId, bytes.path), "utf8")).toBe("fake-png");
  });

  test("prepares screenshot paths without writing screenshot bytes", () => {
    const { root, issueId } = makeIssueRoot();

    const path = prepareIssueEvidencePath({
      root,
      issueId,
      kind: "browser-screenshots",
      filename: "capture-2026-04-30T11-31-00-000Z.png",
    });

    expect(path.path).toBe("evidence/browser-screenshots/capture-2026-04-30T11-31-00-000Z.png");
    expect(path.absolutePath).toBe(join(root, ".gxpm", "issues", issueId, path.path));
    expect(existsSync(path.absolutePath)).toBe(false);
    expect(existsSync(join(root, ".gxpm", "issues", issueId, "evidence", "browser-screenshots"))).toBe(true);
  });

  test("rejects unsafe issue ids, evidence kinds, and filenames before writing", () => {
    const { root, issueId } = makeIssueRoot();

    expect(() =>
      writeIssueEvidenceJson({
        root,
        issueId: `../${issueId}`,
        kind: "investigations",
        filename: "investigation.json",
        payload: {},
      }),
    ).toThrow("Invalid issue id");
    expect(() =>
      writeIssueEvidenceJson({
        root,
        issueId,
        kind: "unknown-kind",
        filename: "investigation.json",
        payload: {},
      }),
    ).toThrow("Invalid evidence kind");
    expect(() =>
      writeIssueEvidenceJson({
        root,
        issueId,
        kind: "investigations",
        filename: "../investigation.json",
        payload: {},
      }),
    ).toThrow("Invalid evidence filename");
    expect(existsSync(join(root, ".gxpm", "issues", issueId, "evidence", "investigations"))).toBe(false);
  });
});
