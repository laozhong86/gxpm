import { describe, it, expect } from "bun:test";
import { GXPM_PHASES } from "../../core/state";

describe("GXPM_PHASES with cleanup", () => {
  it("places cleanup between self-review and ship", () => {
    const phases = GXPM_PHASES as readonly string[];
    const selfReviewIdx = phases.indexOf("self-review");
    const cleanupIdx = phases.indexOf("cleanup");
    const shipIdx = phases.indexOf("ship");
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBe(selfReviewIdx + 1);
    expect(shipIdx).toBe(cleanupIdx + 1);
  });
});
