/**
 * DAG Execution Schemas
 *
 * Types and validation for the gxpm DAG executor.
 * Inspired by Archon's dag-executor.ts and loader.ts,
 * adapted for gxpm's phase-runtime and capability model.
 */

export const TRIGGER_RULES = [
  "all_success",
  "one_success",
  "none_failed_min_one_success",
  "all_done",
] as const;

export type TriggerRule = (typeof TRIGGER_RULES)[number];

export const NODE_STATES = [
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
] as const;

export type NodeState = (typeof NODE_STATES)[number];

/** Base fields every DAG node shares */
export interface DagNodeBase {
  id: string;
  depends_on?: string[];
  trigger_rule?: TriggerRule;
  when?: string;
  retry?: {
    max_attempts: number;
    delay_ms?: number;
    on_error?: "transient" | "all";
  };
}

/** A node that runs an agent prompt */
export interface PromptNode extends DagNodeBase {
  type: "prompt";
  prompt: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  output_format?: Record<string, unknown>;
  maxBudgetUsd?: number;
  allowed_tools?: string[];
  denied_tools?: string[];
}

/** A node that runs a shell/bash command */
export interface BashNode extends DagNodeBase {
  type: "bash";
  bash: string;
}

/** A node that runs a local script file */
export interface ScriptNode extends DagNodeBase {
  type: "script";
  script: string;
}

/** A node that represents a gxpm phase gate */
export interface PhaseNode extends DagNodeBase {
  type: "phase";
  phase: string;
}

/** A no-op node used for gating or grouping */
export interface ApprovalNode extends DagNodeBase {
  type: "approval";
  message?: string;
}

/** A node that cancels the workflow on failure */
export interface CancelNode extends DagNodeBase {
  type: "cancel";
}

export type DagNode =
  | PromptNode
  | BashNode
  | ScriptNode
  | PhaseNode
  | ApprovalNode
  | CancelNode;

export function isPromptNode(node: DagNode): node is PromptNode {
  return node.type === "prompt";
}

export function isBashNode(node: DagNode): node is BashNode {
  return node.type === "bash";
}

export function isScriptNode(node: DagNode): node is ScriptNode {
  return node.type === "script";
}

export function isPhaseNode(node: DagNode): node is PhaseNode {
  return node.type === "phase";
}

export function isApprovalNode(node: DagNode): node is ApprovalNode {
  return node.type === "approval";
}

export function isCancelNode(node: DagNode): node is CancelNode {
  return node.type === "cancel";
}

/** Result of executing a single node */
export interface NodeOutput {
  state: NodeState;
  output: string;
  error?: string;
  durationMs?: number;
  retries?: number;
}

/** Overall DAG execution result */
export interface DagExecutionResult {
  success: boolean;
  nodeOutputs: Map<string, NodeOutput>;
  durationMs: number;
  error?: string;
}

/** Raw workflow definition (before validation) */
export interface WorkflowDefinition {
  name: string;
  description: string;
  provider?: string;
  model?: string;
  nodes: DagNode[];
}

/** Validation / load error */
export interface WorkflowLoadError {
  filename: string;
  error: string;
  errorType: "parse_error" | "validation_error" | "runtime_error";
}

export type ParseResult =
  | { workflow: WorkflowDefinition; error: null }
  | { workflow: null; error: WorkflowLoadError };
