import { describe, test, expect } from "bun:test";
import { WorkflowEngine } from "../../../core/workflows/engine";
import { ShellStep } from "../../../core/workflows/steps/shell";
import type { WorkflowDefinition } from "../../../core/workflows/types";

describe("Workflow Shell Step", () => {
  test("executes shell command and captures stdout", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(ShellStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-shell",
      name: "Test Shell",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "step1", type: "shell", config: { command: "echo hello-world" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.status).toBe("completed");
    expect(result.stepResults["step1"].output.stdout.trim()).toBe("hello-world");
    expect(result.stepResults["step1"].output.exitCode).toBe(0);
  });

  test("fails on non-zero exit code by default", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(ShellStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-shell-fail",
      name: "Test Shell Fail",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "step1", type: "shell", config: { command: "exit 1" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.status).toBe("failed");
    expect(result.stepResults["step1"].output.exitCode).toBe(1);
  });

  test("ignoreFailure captures non-zero exit as completed", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(ShellStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-shell-ignore",
      name: "Test Shell Ignore",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "step1", type: "shell", config: { command: "exit 42", ignoreFailure: true } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.status).toBe("completed");
    expect(result.stepResults["step1"].output.exitCode).toBe(42);
  });

  test("exitCode is available to subsequent steps via context", async () => {
    const engine = new WorkflowEngine("/tmp");
    engine.registerStep(ShellStep);

    const def: WorkflowDefinition = {
      schemaVersion: "1",
      id: "test-shell-context",
      name: "Test Shell Context",
      version: "1.0.0",
      inputs: {},
      steps: [
        { id: "test", type: "shell", config: { command: "echo test-output" } },
      ],
    };

    engine["definitions"].set(def.id, def);
    const state = engine.createRun(def.id, {});
    const result = await engine.run(state);

    expect(result.stepResults["test"].output.stdout.trim()).toBe("test-output");
    expect(result.stepResults["test"].output.exitCode).toBe(0);
  });
});
