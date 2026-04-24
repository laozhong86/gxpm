import { describe, expect, test } from "bun:test";
import { validateGovernanceDocs } from "../scripts/governance-check";

describe("governance docs", () => {
  test("keep root agent docs thin and route specialized rules progressively", () => {
    expect(validateGovernanceDocs()).toEqual([]);
  });
});
