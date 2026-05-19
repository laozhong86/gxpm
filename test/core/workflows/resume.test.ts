import { describe, test, expect } from "bun:test";
import { WorkflowEngine } from "../../../core/workflows/engine";
import { ShellStep } from "../../../core/workflows/steps/shell";
import { GateStep } from "../../../core/workflows/steps/gate";
import type { WorkflowDefinition, RunState } from "../../../core/workflows/types";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("Workflow Resume", () => {
  const projectRoot = "/tmp/gxpm-resume-test";

  function cleanup() {
    try {
      rmSync(join(projectRoot, ".gxpm", "workflows", "runs"), { recursive: true, force: true });
    } catch {}
  }

  test("persists state when paused", async () => {
    cleanup();
    const engine = new WorkflowEngine(projectRoot);
    engine.registerStep(GateStep);
    engine.registerStep(ShellStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-resume-save",
      name: "Test Resume Save",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "pre", type: "shell", config: { command: "echo pre" } },
        { id: "gate", type: "gate", config: { message: "Pause" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.status).toBe("paused");
    const statePath = join(projectRoot, ".gxpm", "workflows", "runs", result.runId, "state.json");
    expect(existsSync(statePath)).toBe(true);
  });

  test("loadState restores previously saved run", async () => {
    cleanup();
    const engine = new WorkflowEngine(projectRoot);
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-resume-load",
      name: "Test Resume Load",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "gate", type: "gate", config: { message: "Pause" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const paused = await engine.run(state);
    expect(paused.status).toBe("paused");

    const loaded = engine.loadState(paused.runId);
    expect(loaded.runId).toBe(paused.runId);
    expect(loaded.status).toBe("paused");
    expect(loaded.currentStepIndex).toBe(0);
  });

  test("resumeFromDisk continues from paused step", async () => {
    cleanup();
    const engine = new WorkflowEngine(projectRoot);
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-resume-disk",
      name: "Test Resume Disk",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "gate", type: "gate", config: { message: "Pause" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const paused = await engine.run(state);
    expect(paused.status).toBe("paused");

    const resumed = await engine.resumeFromDisk(paused.runId);
    expect(resumed.status).toBe("completed");
  });

  test("does not re-run completed steps after resume", async () => {
    cleanup();
    const engine = new WorkflowEngine(projectRoot);
    engine.registerStep(ShellStep);
    engine.registerStep(GateStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-resume-idempotent",
      name: "Test Resume Idempotent",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "s1", type: "shell", config: { command: "echo step1" } },
        { id: "gate", type: "gate", config: { message: "Pause" } },
        { id: "s2", type: "shell", config: { command: "echo step2" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const paused = await engine.run(state);
    expect(paused.status).toBe("paused");
    expect(paused.stepResults["s1"].status).toBe("completed");

    const resumed = await engine.resume(paused);
    expect(resumed.status).toBe("completed");
    // s1 should still be completed, not re-run
    expect(resumed.stepResults["s1"].status).toBe("completed");
    expect(resumed.stepResults["s2"].status).toBe("completed");
  });
});
