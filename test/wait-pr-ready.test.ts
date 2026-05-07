import { describe, expect, test } from "bun:test";
import {
  classifyPrGate,
  normalizeStatusCheckRollup,
  parseWaitPrReadyArgs,
} from "../scripts/wait-pr-ready";

describe("wait-pr-ready args", () => {
  test("parses defaults and explicit polling flags", () => {
    expect(
      parseWaitPrReadyArgs([
        "123",
        "--repo",
        "owner/repo",
        "--interval-sec",
        "30",
        "--timeout-sec",
        "600",
        "--allow-review-required",
        "--once",
        "--json",
      ]),
    ).toEqual({
      pr: "123",
      repo: "owner/repo",
      intervalSec: 30,
      timeoutSec: 600,
      allowReviewRequired: true,
      once: true,
      json: true,
    });
  });

  test("rejects missing PR and non-positive timeout", () => {
    expect(() => parseWaitPrReadyArgs([])).toThrow("Expected exactly one PR");
    expect(() => parseWaitPrReadyArgs(["123", "--timeout-sec", "0"])).toThrow(
      "--timeout-sec requires a positive integer",
    );
  });
});

describe("wait-pr-ready status normalization", () => {
  test("normalizes mixed check and status-context shapes", () => {
    expect(
      normalizeStatusCheckRollup([
        { name: "CodeRabbit", status: "COMPLETED", conclusion: "SUCCESS" },
        { context: "ci/build", state: "PENDING" },
      ]),
    ).toEqual([
      { name: "CodeRabbit", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "ci/build", status: "PENDING", conclusion: "" },
    ]);
  });
});

describe("wait-pr-ready gate classification", () => {
  test("returns ready when review, checks, and merge state are clean", () => {
    expect(
      classifyPrGate({
        headRefOid: "abcdef123456",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        statusCheckRollup: [
          { name: "CodeRabbit", status: "COMPLETED", conclusion: "SUCCESS" },
          { name: "build", status: "COMPLETED", conclusion: "SKIPPED" },
        ],
      }).state,
    ).toBe("ready");
  });

  test("returns pending while CodeRabbit or checks are still running", () => {
    const result = classifyPrGate({
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      statusCheckRollup: [
        { name: "CodeRabbit", status: "IN_PROGRESS", conclusion: null },
      ],
    });

    expect(result.state).toBe("pending");
    expect(result.pendingChecks).toEqual(["CodeRabbit"]);
  });

  test("returns blocked for failed checks, conflicts, and requested changes", () => {
    expect(
      classifyPrGate({
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }],
      }).state,
    ).toBe("blocked");

    expect(
      classifyPrGate({
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
        reviewDecision: "APPROVED",
        statusCheckRollup: [],
      }).state,
    ).toBe("blocked");

    expect(
      classifyPrGate({
        mergeStateStatus: "CLEAN",
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [],
      }).state,
    ).toBe("blocked");
  });

  test("can skip review approval requirement for repos without review gates", () => {
    expect(
      classifyPrGate({
        mergeStateStatus: "CLEAN",
        reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [],
      }).state,
    ).toBe("pending");

    expect(
      classifyPrGate(
        {
          mergeStateStatus: "CLEAN",
          reviewDecision: "REVIEW_REQUIRED",
          statusCheckRollup: [],
        },
        { allowReviewRequired: true },
      ).state,
    ).toBe("ready");
  });
});
