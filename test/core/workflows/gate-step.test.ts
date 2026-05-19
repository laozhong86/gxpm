import { describe, test, expect } from "bun:test";
import { WorkflowEngine, StepRegistry } from "../../../core/workflows/engine";
import { GateStep } from "../../../core/workflows/steps/gate";
import type { RunState, WorkflowDefinition } from "../../../core/workflows/types";

describe("Workflow Gate Step", () => {
  test("gate step pauses execution and persists state", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-gate",
      name: "Test Gate",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "step1", type: "gate", config: { message: "Approve before continue" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.status).toBe("paused");
    expect(result.stepResults["step1"].status).toBe("paused");
    expect(result.stepResults["step1"].output.message).toBe("Approve before continue");
  });

  test("gate step skips when condition is false", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-gate-skip",
      name: "Test Gate Skip",
      version: "1.0.0",
      inputs: { skipGate: true },
      steps: [
        { id: "step1", type: "gate", config: { message: "Skip me", condition: "{{ inputs.skipGate }}" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, { skipGate: true });
    const result = await engine.run(state);

    expect(result.status).toBe("completed");
    expect(result.stepResults["step1"].status).toBe("skipped");
  });

  test("resume continues from paused gate step", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-gate-resume",
      name: "Test Gate Resume",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "step1", type: "gate", config: { message: "Approve" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const paused = await engine.run(state);
    expect(paused.status).toBe("paused");

    const resumed = await engine.resume(paused);
    expect(resumed.status).toBe("completed");
  });
});
