import { describe, expect, it } from "bun:test";
import { PHASE_GATE_RULES, getRequiredArtifactForTransition } from "../../core/phase-gates";

describe("phase-gates with specify", () => {
  it("requires dispatch-handoff for dispatch->specify", () => {
    expect(getRequiredArtifactForTransition("dispatch", "specify")).toBe("dispatch-handoff");
  });

  it("requires behavior-spec for specify->implement", () => {
    expect(getRequiredArtifactForTransition("specify", "implement")).toBe("behavior-spec");
  });

  it("removes original dispatch->implement direct rule", () => {
    const direct = PHASE_GATE_RULES.find(
      (r) => r.fromPhase === "dispatch" && r.nextPhase === "implement",
    );
    expect(direct).toBeUndefined();
  });

  it("registers a handler for behavior-spec so PHASE_ARTIFACT_COMMANDS imports cleanly", async () => {
    // Importing this module triggers the .map() over PHASE_GATE_RULES which throws
    // if any rule's requiredArtifact has no handler. Successful import = handler exists.
    await import("../../scripts/phase-artifact-commands");
  });
});
