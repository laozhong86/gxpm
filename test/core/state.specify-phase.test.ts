import { describe, expect, it } from "bun:test";
import { GXPM_PHASES } from "../../core/state";

describe("GXPM_PHASES with specify", () => {
  it("places specify between dispatch and implement", () => {
    const phases = GXPM_PHASES as readonly string[];
    const dispatchIdx = phases.indexOf("dispatch");
    const specifyIdx = phases.indexOf("specify");
    const implementIdx = phases.indexOf("implement");
    expect(specifyIdx).toBeGreaterThan(-1);
    expect(specifyIdx).toBe(dispatchIdx + 1);
    expect(implementIdx).toBe(specifyIdx + 1);
  });
});
