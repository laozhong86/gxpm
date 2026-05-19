// WORKFLOW ENGINE — public API.

export {
  WorkflowEngine,
  StepRegistry,
  parseWorkflowYaml,
} from "./engine";
export {
  evaluateExpression,
  evaluateCondition,
} from "./expressions";
export type {
  WorkflowDefinition,
  WorkflowInputSchema,
  StepConfig,
  StepBase,
  StepContext,
  StepResult,
  RunState,
  RunStatus,
  StepStatus,
} from "./types";

// Built-in step types
export { CommandStep } from "./steps/command";
export { LinearStep } from "./steps/linear";
export { GxpmStep } from "./steps/gxpm";
export { GateStep } from "./steps/gate";
export { ShellStep } from "./steps/shell";

// Convenience: register all built-in steps
export function registerBuiltinSteps(engine: WorkflowEngine): void {
  engine.registerStep(CommandStep);
  engine.registerStep(LinearStep);
  engine.registerStep(GxpmStep);
  engine.registerStep(GateStep);
  engine.registerStep(ShellStep);
}
