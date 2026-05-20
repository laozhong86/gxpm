import { describe, test, expect } from "bun:test";
import {
  isToolAllowedInPhase,
  queryToolPermission,
  getRestrictionsForPhase,
} from "../core/role-capability-gate";

describe("GXPM-144: phase-aware tool permission query", () => {
  test("scn-01: self-review forbids 'git push --force'", () => {
    expect(isToolAllowedInPhase("git push --force", "self-review")).toBe(false);
    const decision = queryToolPermission("git push --force", "self-review");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRestriction).toBe("git push --force");
    expect(decision.reason).toContain("self-review");
  });

  test("scn-02: implement permits 'git push --force'", () => {
    expect(isToolAllowedInPhase("git push --force", "implement")).toBe(true);
    expect(queryToolPermission("git push --force", "implement").allowed).toBe(true);
  });

  test("scn-03: unknown tools default to allowed", () => {
    expect(isToolAllowedInPhase("xxx-unknown-tool", "self-review")).toBe(true);
    expect(isToolAllowedInPhase("anything-else", "qa")).toBe(true);
  });

  test("bonus-1: 'git push --force-with-lease' is allowed (prefix needs trailing space)", () => {
    expect(isToolAllowedInPhase("git push --force-with-lease", "self-review")).toBe(true);
    expect(isToolAllowedInPhase("git push --force origin main", "self-review")).toBe(false);
  });

  test("bonus-2: verify phase forbids gxpm phase rewind", () => {
    expect(isToolAllowedInPhase("gxpm phase rewind GXPM-1 --to implement", "verify")).toBe(false);
  });

  test("bonus-3: land phase has no tool restrictions", () => {
    expect(isToolAllowedInPhase("gxpm cleanup land GXPM-1 --execute", "land")).toBe(true);
    expect(getRestrictionsForPhase("land")).toEqual([]);
  });

  test("bonus-4: getRestrictionsForPhase exposes blocked patterns", () => {
    const r = getRestrictionsForPhase("self-review");
    expect(r).toContain("git push --force");
    expect(r).toContain("gxpm cleanup land");
  });
});
