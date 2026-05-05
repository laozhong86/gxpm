import { describe, it, expect } from "bun:test";
import {
  WorkflowEngine,
  parseWorkflowYaml,
  evaluateExpression,
  evaluateCondition,
  CommandStep,
} from "../../core/workflows";
import type { StepContext } from "../../core/workflows";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("WorkflowEngine", () => {
  it("parses a simple YAML workflow", () => {
    const yaml = `
schemaVersion: "0.1"
id: test-workflow
name: Test Workflow
version: "1.0.0"
inputs:
  name:
    type: string
    required: true
steps:
  - id: greet
    type: command
    config:
      command: echo hello
`;
    const def = parseWorkflowYaml(yaml);
    expect(def.id).toBe("test-workflow");
    expect(def.name).toBe("Test Workflow");
    expect(def.steps.length).toBe(1);
    expect(def.steps[0].id).toBe("greet");
    expect(def.steps[0].type).toBe("command");
  });

  it("registers and executes a command step", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-wf-"));
    const engine = new WorkflowEngine(tmp);
    engine.registerStep(CommandStep);

    const yaml = `
schemaVersion: "0.1"
id: cmd-test
name: Command Test
version: "1.0.0"
inputs: {}
steps:
  - id: hello
    type: command
    config:
      command: echo hello-world
      captureOutput: true
`;
    writeFileSync(join(tmp, "workflow.yaml"), yaml);
    const def = engine.loadYaml("workflow.yaml");
    expect(def.id).toBe("cmd-test");

    const state = engine.createRun("cmd-test", {});
    const result = await engine.run(state);
    expect(result.status).toBe("completed");
    expect(result.stepResults.hello.status).toBe("completed");
    expect(result.stepResults.hello.output.stdout).toContain("hello-world");
  });

  it("fails on unknown step type", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-wf-"));
    const engine = new WorkflowEngine(tmp);

    const yaml = `
schemaVersion: "0.1"
id: unknown-step
name: Unknown Step
version: "1.0.0"
inputs: {}
steps:
  - id: bad
    type: nonexistent
    config: {}
`;
    writeFileSync(join(tmp, "workflow.yaml"), yaml);
    engine.loadYaml("workflow.yaml");

    const state = engine.createRun("unknown-step", {});
    const result = await engine.run(state);
    expect(result.status).toBe("failed");
    expect(result.stepResults.bad.status).toBe("failed");
    expect(result.stepResults.bad.error).toContain("Unknown step type");
  });

  it("evaluates variable expressions", () => {
    const ctx: StepContext = {
      inputs: { name: "Alice" },
      steps: {},
      runId: "r1",
      projectRoot: "/tmp",
    };
    expect(evaluateExpression("Hello ${inputs.name}!", ctx)).toBe("Hello Alice!");
    expect(evaluateExpression("No vars here", ctx)).toBe("No vars here");
  });

  it("evaluates conditions", () => {
    const ctx: StepContext = {
      inputs: { enabled: true, count: 0 },
      steps: {},
      runId: "r1",
      projectRoot: "/tmp",
    };
    expect(evaluateCondition("${inputs.enabled}", ctx)).toBe(true);
    expect(evaluateCondition("${inputs.count}", ctx)).toBe(false);
    expect(evaluateCondition("true", ctx)).toBe(true);
    expect(evaluateCondition("false", ctx)).toBe(false);
  });

  it("supports resume after pause (mock)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-wf-"));
    const engine = new WorkflowEngine(tmp);

    const PauseStep = {
      typeKey: "pause",
      execute() {
        return { status: "paused" as const, output: {} };
      },
      canResume() {
        return true;
      },
    };
    engine.registerStep(PauseStep);
    engine.registerStep(CommandStep);

    const yaml = `
schemaVersion: "0.1"
id: pause-test
name: Pause Test
version: "1.0.0"
inputs: {}
steps:
  - id: p
    type: pause
    config: {}
  - id: c
    type: command
    config:
      command: echo after-pause
      captureOutput: true
`;
    writeFileSync(join(tmp, "workflow.yaml"), yaml);
    engine.loadYaml("workflow.yaml");

    let state = engine.createRun("pause-test", {});
    state = await engine.run(state);
    expect(state.status).toBe("paused");
    expect(state.stepResults.p.status).toBe("paused");

    state = await engine.resume(state);
    expect(state.status).toBe("completed");
    expect(state.stepResults.c.status).toBe("completed");
  });

  it("validates step config before execution", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-wf-"));
    const engine = new WorkflowEngine(tmp);
    engine.registerStep(CommandStep);

    const yaml = `
schemaVersion: "0.1"
id: validation-test
name: Validation Test
version: "1.0.0"
inputs: {}
steps:
  - id: invalid
    type: command
    config:
      missingCommand: true
`;
    writeFileSync(join(tmp, "workflow.yaml"), yaml);
    engine.loadYaml("workflow.yaml");

    const state = engine.createRun("validation-test", {});
    const result = await engine.run(state);
    expect(result.status).toBe("failed");
    expect(result.stepResults.invalid.status).toBe("failed");
    expect(result.stepResults.invalid.error).toContain("Validation");
  });
});
