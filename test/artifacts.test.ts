import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../core/state";
import {
  listArtifacts,
  readArtifact,
  writeArtifact,
} from "../core/artifacts";

describe("artifact store", () => {
  test("writes artifacts, updates the index, and records an event", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-artifact-"));
    createIssueState({ root, issueId: "GXPM-20" });

    const artifact = writeArtifact({
      root,
      issueId: "GXPM-20",
      type: "acceptance-contract",
      payload: { criteria: [{ id: "AC-1", text: "state persists", status: "pending" }] },
    });

    expect(artifact.type).toBe("acceptance-contract");
    expect(artifact.path).toBe("artifacts/acceptance-contract.json");
    expect(existsSync(join(root, ".gxpm", "issues", "GXPM-20", artifact.path))).toBe(true);
    expect(readArtifact({ root, issueId: "GXPM-20", type: "acceptance-contract" }).payload).toEqual({
      criteria: [{ id: "AC-1", text: "state persists", status: "pending" }],
    });
    expect(listArtifacts({ root, issueId: "GXPM-20" }).map((item) => item.type)).toEqual([
      "acceptance-contract",
    ]);

    const index = JSON.parse(
      readFileSync(join(root, ".gxpm", "issues", "GXPM-20", "artifacts", "index.json"), "utf8"),
    );
    expect(index.artifacts).toEqual([
      expect.objectContaining({ type: "acceptance-contract", path: "artifacts/acceptance-contract.json" }),
    ]);

    const events = readFileSync(join(root, ".gxpm", "issues", "GXPM-20", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "artifact.written",
      payload: { artifactType: "acceptance-contract" },
    });
  });

  test("rejects unknown artifact types", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-artifact-invalid-"));
    createIssueState({ root, issueId: "GXPM-21" });

    expect(() =>
      writeArtifact({
        root,
        issueId: "GXPM-21",
        type: "random-note",
        payload: {},
      }),
    ).toThrow("Invalid artifact type");
  });
});
