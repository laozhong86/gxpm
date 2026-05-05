// WORKFLOW ENGINE — core types and interfaces.
// Zero external dependencies beyond Node.js builtins.

export type RunStatus = "created" | "running" | "paused" | "completed" | "failed" | "aborted";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "paused";

export interface WorkflowDefinition {
  schemaVersion: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  inputs: Record<string, WorkflowInputSchema>;
  steps: StepConfig[];
}

export interface WorkflowInputSchema {
  type: "string" | "boolean" | "number" | "array";
  required?: boolean;
  default?: unknown;
}

export interface StepConfig {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface StepContext {
  inputs: Record<string, unknown>;
  steps: Record<string, StepResult>;
  runId: string;
  projectRoot: string;
  item?: unknown;
  fanIn?: unknown[];
}

export interface StepResult {
  status: StepStatus;
  output: Record<string, unknown>;
  nextSteps?: StepConfig[];
  error?: string;
}

export interface RunState {
  runId: string;
  workflowId: string;
  status: RunStatus;
  currentStepIndex: number;
  stepIndexStack: number[];
  stepResults: Record<string, StepResult>;
  inputs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StepBase {
  readonly typeKey: string;
  execute(config: Record<string, unknown>, context: StepContext): StepResult | Promise<StepResult>;
  validate?(config: Record<string, unknown>): string[];
  canResume?(state: StepResult): boolean;
}
