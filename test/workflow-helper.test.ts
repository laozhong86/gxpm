import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIssueState } from "../core/state";
import { enterPhase, enterPhaseCli } from "./helpers/workflow";

describe("workflow test helpers", () => {
  test("enterPhase drives core workflow setup to the requested phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-helper-core-"));

    enterPhase(root, "GXPM-140", "qa");

    expect(readIssueState({ root, issueId: "GXPM-140" }).currentPhase).toBe("qa");
  });

  test("enterPhaseCli drives CLI workflow setup to the requested phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-helper-cli-"));

    enterPhaseCli(root, "GXPM-141", "land");

    expect(readIssueState({ root, issueId: "GXPM-141" }).currentPhase).toBe("land");
  });
});
