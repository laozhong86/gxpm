// WORKFLOW ENGINE — declarative workflow runtime.
// Loads YAML definitions, executes step-by-step, supports resume.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import type {
  WorkflowDefinition,
  StepConfig,
  StepBase,
  StepContext,
  StepResult,
  RunState,
  RunStatus,
  StepStatus,
} from "./types";
import { evaluateCondition, evaluateExpression } from "./expressions";

export class StepRegistry {
  private steps = new Map<string, StepBase>();

  register(step: StepBase): void {
    if (this.steps.has(step.typeKey)) {
      throw new Error(`Step type ${step.typeKey} already registered`);
    }
    this.steps.set(step.typeKey, step);
  }

  get(typeKey: string): StepBase | undefined {
    return this.steps.get(typeKey);
  }

  has(typeKey: string): boolean {
    return this.steps.has(typeKey);
  }

  list(): string[] {
    return Array.from(this.steps.keys());
  }
}

export class WorkflowEngine {
  private registry = new StepRegistry();
  private definitions = new Map<string, WorkflowDefinition>();

  constructor(private projectRoot: string) {}

  getRegistry(): StepRegistry {
    return this.registry;
  }

  registerStep(step: StepBase): void {
    this.registry.register(step);
  }

  loadYaml(yamlPath: string): WorkflowDefinition {
    const absPath = join(this.projectRoot, yamlPath);
    const text = readFileSync(absPath, "utf8");
    const def = parseWorkflowYaml(text);
    this.definitions.set(def.id, def);
    return def;
  }

  createRun(workflowId: string, inputs: Record<string, unknown>): RunState {
    const def = this.definitions.get(workflowId);
    if (!def) throw new Error(`Workflow ${workflowId} not loaded`);

    const runId = randomUUID();
    return {
      runId,
      workflowId,
      status: "created",
      currentStepIndex: -1,
      stepIndexStack: [],
      stepResults: {},
      inputs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async run(state: RunState): Promise<RunState> {
    const def = this.definitions.get(state.workflowId);
    if (!def) throw new Error(`Workflow ${state.workflowId} not loaded`);

    state.status = "running";
    state.updatedAt = new Date().toISOString();

    const ctx: StepContext = {
      inputs: state.inputs,
      steps: state.stepResults,
      runId: state.runId,
      projectRoot: this.projectRoot,
    };

    while (state.currentStepIndex < def.steps.length - 1) {
      state.currentStepIndex++;
      const stepConfig = def.steps[state.currentStepIndex];

      if (stepConfig.type === "if") {
        const condition = stepConfig.config.condition as string;
        const shouldRun = evaluateCondition(condition, ctx);
        if (!shouldRun) {
          state.stepResults[stepConfig.id] = { status: "skipped", output: {} };
          continue;
        }
        state.stepIndexStack.push(state.currentStepIndex);
        continue;
      }

      if (stepConfig.type === "endif") {
        state.stepIndexStack.pop();
        continue;
      }

      if (stepConfig.type === "foreach") {
        state.stepIndexStack.push(state.currentStepIndex);
        const collection = resolveValue(stepConfig.config.collection, ctx) as unknown[];
        if (!Array.isArray(collection) || collection.length === 0) {
          state.stepResults[stepConfig.id] = { status: "skipped", output: {} };
          state.stepIndexStack.pop();
          continue;
        }
        const results: StepResult[] = [];
        for (const item of collection) {
          const subSteps = stepConfig.config.steps as StepConfig[];
          for (const subStep of subSteps) {
            const result = await this.executeStep(subStep, { ...ctx, item }, state);
            results.push(result);
          }
        }
        state.stepResults[stepConfig.id] = {
          status: "completed",
          output: { results },
        };
        state.stepIndexStack.pop();
        continue;
      }

      const result = await this.executeStep(stepConfig, ctx, state);
      ctx.steps = state.stepResults;

      if (result.status === "failed") {
        state.status = "failed";
        state.updatedAt = new Date().toISOString();
        return state;
      }

      if (result.status === "paused") {
        state.status = "paused";
        state.updatedAt = new Date().toISOString();
        return state;
      }
    }

    state.status = "completed";
    state.updatedAt = new Date().toISOString();
    return state;
  }

  async resume(state: RunState): Promise<RunState> {
    if (state.status !== "paused") {
      throw new Error(`Cannot resume run in status ${state.status}`);
    }
    const lastStep = this.getLastStep(state);
    if (lastStep && lastStep.status === "paused") {
      const handler = this.registry.get(lastStep.stepId);
      if (handler?.canResume && !handler.canResume(lastStep)) {
        throw new Error(`Step ${lastStep.stepId} cannot be resumed`);
      }
    }
    return this.run(state);
  }

  private async executeStep(
    stepConfig: StepConfig,
    ctx: StepContext,
    state: RunState,
  ): Promise<StepResult> {
    const handler = this.registry.get(stepConfig.type);
    if (!handler) {
      const err = new Error(`Unknown step type: ${stepConfig.type}`);
      const result: StepResult = {
        status: "failed",
        output: {},
        error: err.message,
      };
      state.stepResults[stepConfig.id] = result;
      return result;
    }

    // Validate config
    if (handler.validate) {
      const errors = handler.validate(stepConfig.config);
      if (errors.length > 0) {
        const result: StepResult = {
          status: "failed",
          output: {},
          error: `Validation: ${errors.join("; ")}`,
        };
        state.stepResults[stepConfig.id] = result;
        return result;
      }
    }

    try {
      const result = await handler.execute(stepConfig.config, ctx);
      state.stepResults[stepConfig.id] = result;
      return result;
    } catch (err) {
      const result: StepResult = {
        status: "failed",
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
      state.stepResults[stepConfig.id] = result;
      return result;
    }
  }

  private getLastStep(state: RunState): { stepId: string; status: StepStatus } | null {
    const entries = Object.entries(state.stepResults);
    if (entries.length === 0) return null;
    const [lastId, lastResult] = entries[entries.length - 1];
    return { stepId: lastId, status: lastResult.status };
  }
}

function resolveValue(template: unknown, context: StepContext): unknown {
  if (typeof template === "string") {
    return evaluateExpression(template, context);
  }
  return template;
}

// Parse workflow YAML using the 'yaml' library.
export function parseWorkflowYaml(text: string): WorkflowDefinition {
  const doc = YAML.parse(text);
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid YAML: document is not an object");
  }
  return doc as WorkflowDefinition;
}
