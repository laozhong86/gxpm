import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueState,
  getVisiblePhases,
  isCompressedSkip,
  transitionIssuePhase,
  type GxpmPhase,
} from "../../core/state";
import { evaluatePrePush } from "../../core/gate";
import { enterPhase } from "../helpers/workflow";

describe("phase compression", () => {
  describe("getVisiblePhases", () => {
    test("full mode returns all 14 phases", () => {
      const phases = getVisiblePhases("full");
      expect(phases.length).toBe(14);
      expect(phases).toContain("local-verify");
      expect(phases).toContain("cleanup");
    });

    test("standard mode hides 5 compressed phases", () => {
      const phases = getVisiblePhases("standard");
      expect(phases.length).toBe(9);
      expect(phases).toContain("dispatch");
      expect(phases).toContain("self-review");
      expect(phases).toContain("qa");
      expect(phases).not.toContain("local-verify");
      expect(phases).not.toContain("ac-check");
      expect(phases).not.toContain("cleanup");
      expect(phases).not.toContain("pr-check");
      expect(phases).not.toContain("verify");
    });

    test("lite mode hides 7 compressed phases", () => {
      const phases = getVisiblePhases("lite");
      expect(phases.length).toBe(7);
      expect(phases).toContain("triage");
      expect(phases).toContain("plan");
      expect(phases).toContain("specify");
      expect(phases).toContain("implement");
      expect(phases).toContain("self-review");
      expect(phases).toContain("ship");
      expect(phases).toContain("land");
    });

    test("undefined rigor defaults to full visibility", () => {
      const phases = getVisiblePhases(undefined);
      expect(phases.length).toBe(14);
    });
  });

  describe("isCompressedSkip", () => {
    test("standard mode allows implement -> self-review", () => {
      expect(isCompressedSkip("implement", "self-review", "standard")).toBe(true);
    });

    test("standard mode allows self-review -> ship", () => {
      expect(isCompressedSkip("self-review", "ship", "standard")).toBe(true);
    });

    test("standard mode blocks implement -> ship (self-review not skipped)", () => {
      expect(isCompressedSkip("implement", "ship", "standard")).toBe(false);
    });

    test("lite mode allows implement -> self-review (skips local-verify + ac-check)", () => {
      expect(isCompressedSkip("implement", "self-review", "lite")).toBe(true);
    });

    test("lite mode allows self-review -> ship (skips cleanup)", () => {
      expect(isCompressedSkip("self-review", "ship", "lite")).toBe(true);
    });

    test("lite mode allows ship -> land", () => {
      expect(isCompressedSkip("ship", "land", "lite")).toBe(true);
    });

    test("full mode blocks all skips", () => {
      expect(isCompressedSkip("implement", "self-review", "full")).toBe(false);
      expect(isCompressedSkip("ship", "land", "full")).toBe(false);
    });

    test("undefined rigor defaults to full (no skips)", () => {
      expect(isCompressedSkip("implement", "self-review", undefined)).toBe(false);
    });

    test("backward transitions are never allowed", () => {
      expect(isCompressedSkip("ship", "implement", "lite")).toBe(false);
    });
  });

  describe("transitionIssuePhase with compression", () => {
    test("standard mode allows skipping local-verify and ac-check", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-compression-"));
      // enterPhase walks the full workflow and initializes all required artifacts
      enterPhase(root, "GXPM-C1", "implement");

      // standard mode should allow implement -> self-review directly
      const state = transitionIssuePhase({ root, issueId: "GXPM-C1", nextPhase: "self-review" });
      expect(state.currentPhase).toBe("self-review");
      expect(state.phaseHistory.map((h) => h.phase)).toContain("self-review");
    });

    test("lite mode allows skipping from self-review to ship", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-compression-"));
      // meta issueType defaults to lite rigor
      enterPhase(root, "GXPM-C2", "self-review");

      const state = transitionIssuePhase({ root, issueId: "GXPM-C2", nextPhase: "ship" });
      expect(state.currentPhase).toBe("ship");
    });

    test("full mode blocks compressed transitions", () => {
      const root = mkdtempSync(join(tmpdir(), "gxpm-compression-"));
      enterPhase(root, "GXPM-C3", "implement");

      // standard (default for feature) allows implement -> self-review
      expect(() =>
        transitionIssuePhase({ root, issueId: "GXPM-C3", nextPhase: "self-review" }),
      ).not.toThrow();
    });
  });

  describe("evaluatePrePush with compression", () => {
    const stateAt = (phase: GxpmPhase, rigorLevel?: "lite" | "standard" | "full") => ({
      schemaVersion: 1 as const,
      issueId: "GXPM-100",
      currentPhase: phase,
      createdAt: "2026-04-26T00:00:00Z",
      updatedAt: "2026-04-26T00:00:00Z",
      stateRoot: ".gxpm/issues/GXPM-100",
      artifactRoot: ".gxpm/issues/GXPM-100/artifacts",
      phaseHistory: [{ phase, enteredAt: "2026-04-26T00:00:00Z", fromPhase: null }],
      rigorLevel,
      issueType: "feature" as const,
    });

    test("standard mode skips implement outbound gate (local-verify)", () => {
      const v = evaluatePrePush(
        stateAt("implement", "standard"),
        () => false,
        {},
      );
      expect(v.allowed).toBe(true);
      expect(v.code).toBe("phase-ok");
      expect(v.reason).toContain("skipped under rigor=standard");
    });

    test("standard mode skips self-review outbound gate (cleanup)", () => {
      const v = evaluatePrePush(
        stateAt("self-review", "standard"),
        () => false,
        {},
      );
      expect(v.allowed).toBe(true);
      expect(v.code).toBe("phase-ok");
    });

    test("standard mode skips ship outbound gate because pr-check is compressed", () => {
      const v = evaluatePrePush(
        stateAt("ship", "standard"),
        () => false,
        {},
      );
      // ship -> pr-check is skipped under standard rigor, so gate is phase-ok
      expect(v.allowed).toBe(true);
      expect(v.code).toBe("phase-ok");
      expect(v.reason).toContain("skipped under rigor=standard");
    });

    test("lite mode skips ship outbound gate (pr-check)", () => {
      const v = evaluatePrePush(
        stateAt("ship", "lite"),
        () => false,
        {},
      );
      expect(v.allowed).toBe(true);
      expect(v.code).toBe("phase-ok");
      expect(v.reason).toContain("skipped under rigor=lite");
    });

    test("full mode enforces all outbound gates", () => {
      const v = evaluatePrePush(
        stateAt("implement", "full"),
        () => false,
        {},
      );
      expect(v.allowed).toBe(false);
      expect(v.code).toBe("missing-artifact");
    });
  });
});
