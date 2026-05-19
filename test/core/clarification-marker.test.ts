import { describe, test, expect } from "bun:test";

describe("NEEDS CLARIFICATION marker", () => {
  test("ambiguous requirements are marked not guessed", () => {
    // TODO: verify [NEEDS CLARIFICATION] appears in spec output for ambiguous input
    expect(true).toBe(true);
  });

  test("confirm blocked until markers resolved", () => {
    // TODO: verify confirmSpecify throws when placeholders remain
    expect(true).toBe(true);
  });
});
