/**
 * DAG Executor
 *
 * Executes a nodes-based workflow in topological order.
 * Independent nodes within the same layer run concurrently via Promise.allSettled.
 * Supports trigger rules, when conditions, and $node_id.output substitution.
 */
import type {
  DagNode,
  TriggerRule,
  NodeOutput,
  NodeState,
  DagExecutionResult,
} from "./dag-schemas";
import { isCancelNode } from "./dag-schemas";

export type NodeExecutor = (node: DagNode, context: DagContext) => Promise<NodeOutput>;

export interface DagContext {
  workflowName: string;
  nodeOutputs: Map<string, NodeOutput>;
  cwd: string;
  abortSignal?: AbortSignal;
}

const DEFAULT_NODE_MAX_RETRIES = 2;
const DEFAULT_NODE_RETRY_DELAY_MS = 3000;

function getEffectiveRetryConfig(node: DagNode): {
  maxRetries: number;
  delayMs: number;
  onError: "transient" | "all";
} {
  if (node.retry) {
    return {
      maxRetries: node.retry.max_attempts,
      delayMs: node.retry.delay_ms ?? DEFAULT_NODE_RETRY_DELAY_MS,
      onError: node.retry.on_error ?? "transient",
    };
  }
  return {
    maxRetries: DEFAULT_NODE_MAX_RETRIES,
    delayMs: DEFAULT_NODE_RETRY_DELAY_MS,
    onError: "transient",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build topological layers from DAG nodes using Kahn's algorithm.
 * Layer 0: nodes with no dependencies.
 * Layer N: nodes whose dependencies are all in layers 0..N-1.
 */
export function buildTopologicalLayers(nodes: readonly DagNode[]): DagNode[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, node.depends_on?.length ?? 0);
    for (const dep of node.depends_on ?? []) {
      const existing = dependents.get(dep) ?? [];
      existing.push(node.id);
      dependents.set(dep, existing);
    }
  }

  const layers: DagNode[][] = [];
  let ready = [...nodes].filter((n) => (inDegree.get(n.id) ?? 0) === 0);

  while (ready.length > 0) {
    layers.push(ready);
    const nextIds: string[] = [];
    for (const node of ready) {
      for (const depId of dependents.get(node.id) ?? []) {
        const newDegree = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) nextIds.push(depId);
      }
    }
    ready = nextIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is DagNode => n !== undefined);
  }

  const totalPlaced = layers.reduce((sum, l) => sum + l.length, 0);
  if (totalPlaced < nodes.length) {
    throw new Error(
      "[DagExecutor] Cycle detected at runtime — was cycle detection skipped at load?"
    );
  }

  return layers;
}

/**
 * Evaluate trigger rule for a node given its upstream states.
 */
export function checkTriggerRule(
  node: DagNode,
  nodeOutputs: Map<string, NodeOutput>
): "run" | "skip" {
  const nodeDeps = node.depends_on ?? [];
  if (nodeDeps.length === 0) return "run";

  const upstreams = nodeDeps.map(
    (id) =>
      nodeOutputs.get(id) ??
      ({
        state: "failed",
        output: "",
        error: `upstream '${id}' missing from outputs`,
      } as NodeOutput)
  );

  const rule: TriggerRule = node.trigger_rule ?? "all_success";

  switch (rule) {
    case "all_success":
      return upstreams.every((u) => u.state === "completed") ? "run" : "skip";
    case "one_success":
      return upstreams.some((u) => u.state === "completed") ? "run" : "skip";
    case "none_failed_min_one_success": {
      const anyFailed = upstreams.some((u) => u.state === "failed");
      const anySucceeded = upstreams.some((u) => u.state === "completed");
      return !anyFailed && anySucceeded ? "run" : "skip";
    }
    case "all_done":
      return upstreams.every((u) => u.state !== "pending" && u.state !== "running")
        ? "run"
        : "skip";
  }
}

/**
 * Substitute $node_id.output and $node_id.output.field references in a string.
 */
export function substituteNodeOutputRefs(
  text: string,
  nodeOutputs: Map<string, NodeOutput>
): string {
  return text.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    (match, nodeId: string, field: string | undefined) => {
      const nodeOutput = nodeOutputs.get(nodeId);
      if (!nodeOutput) {
        return "";
      }
      if (!field) {
        return nodeOutput.output;
      }
      try {
        const parsed = JSON.parse(nodeOutput.output) as Record<string, unknown>;
        const value = parsed[field];
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        return "";
      } catch {
        return "";
      }
    }
  );
}

/**
 * Evaluate a when condition string against upstream node outputs.
 * Supports simple expressions referencing $node_id.output and comparison operators.
 * Returns true if the condition passes, false otherwise.
 */
export function evaluateWhenCondition(
  condition: string,
  nodeOutputs: Map<string, NodeOutput>
): boolean {
  // Substitute output refs with JSON-stringified values for safe JS evaluation
  const substituted = condition.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    (match, nodeId: string, field: string | undefined) => {
      const nodeOutput = nodeOutputs.get(nodeId);
      if (!nodeOutput) {
        return "null";
      }
      let value: unknown;
      if (!field) {
        value = nodeOutput.output;
      } else {
        try {
          const parsed = JSON.parse(nodeOutput.output) as Record<string, unknown>;
          value = parsed[field];
        } catch {
          return "null";
        }
      }
      if (value === undefined || value === null) return "null";
      if (typeof value === "string") return JSON.stringify(value);
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return "null";
    }
  );

  // Whitelist-only expression evaluator
  // Allowed: literals (string, number, boolean), comparisons (==, !=, <, >, <=, >=),
  // logical operators (&&, ||, !), and grouping parentheses.
  const sanitized = substituted.trim();

  if (!sanitized) return true;

  // Security: reject any characters outside the whitelist
  const whitelist = /^[\s\w\d_+\-*/%=<>!&|().,'"`?:\[\]]*$/;
  if (!whitelist.test(sanitized)) {
    throw new Error(`When condition contains disallowed characters: ${condition}`);
  }

  // Reject dangerous patterns
  const dangerous =
    /\b(eval|Function|constructor|prototype|window|global|process|require|import|fetch| XMLHttpRequest)\b/i;
  if (dangerous.test(sanitized)) {
    throw new Error(`When condition contains disallowed keyword: ${condition}`);
  }

  // Build a safe expression by wrapping in a function
  try {
    const fn = new Function(`return (${sanitized})`);
    const result = fn();
    return Boolean(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`When condition evaluation failed: ${condition} — ${message}`);
  }
}

/**
 * Execute a single node with retry logic.
 */
async function executeNodeWithRetry(
  node: DagNode,
  context: DagContext,
  executor: NodeExecutor
): Promise<NodeOutput> {
  const { maxRetries, delayMs, onError } = getEffectiveRetryConfig(node);
  let lastError: NodeOutput | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (context.abortSignal?.aborted) {
      return {
        state: "failed",
        output: "",
        error: "Aborted by abort signal",
      };
    }

    try {
      const result = await executor(node, context);
      if (result.state !== "failed") {
        return { ...result, retries: attempt };
      }
      lastError = result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      lastError = {
        state: "failed",
        output: "",
        error: errorMessage,
      };
    }

    const shouldRetry =
      onError === "all" || (lastError.error && isTransientError(lastError.error));

    if (attempt < maxRetries && shouldRetry) {
      await delay(delayMs * (attempt + 1)); // exponential-ish backoff
    }
  }

  return { ...lastError!, retries: maxRetries };
}

function isTransientError(errorMessage: string): boolean {
  const transientPatterns = [
    /timeout/i,
    /econnreset/i,
    /econnrefused/i,
    /etimedout/i,
    /network/i,
    /temporary/i,
    /rate.?limit/i,
    /503/i,
    /502/i,
    /504/i,
  ];
  return transientPatterns.some((p) => p.test(errorMessage));
}

/**
 * Execute a DAG workflow.
 */
export async function executeDag(
  nodes: readonly DagNode[],
  executor: NodeExecutor,
  options: {
    workflowName?: string;
    cwd?: string;
    abortSignal?: AbortSignal;
    onNodeStart?: (nodeId: string) => void;
    onNodeComplete?: (nodeId: string, output: NodeOutput) => void;
  } = {}
): Promise<DagExecutionResult> {
  const startTime = Date.now();
  const nodeOutputs = new Map<string, NodeOutput>();
  const layers = buildTopologicalLayers(nodes);
  const workflowName = options.workflowName ?? "unnamed-workflow";
  const cwd = options.cwd ?? process.cwd();

  for (const layer of layers) {
    const layerResults = await Promise.allSettled(
      layer.map(async (node) => {
        if (options.abortSignal?.aborted) {
          return {
            node,
            output: {
              state: "failed" as NodeState,
              output: "",
              error: "Aborted by abort signal",
            },
          };
        }

        // Check trigger rule
        const triggerDecision = checkTriggerRule(node, nodeOutputs);
        if (triggerDecision === "skip") {
          const skippedOutput: NodeOutput = {
            state: "skipped",
            output: "",
          };
          nodeOutputs.set(node.id, skippedOutput);
          options.onNodeComplete?.(node.id, skippedOutput);
          return { node, output: skippedOutput };
        }

        // Check when condition
        if (node.when) {
          try {
            const whenResult = evaluateWhenCondition(node.when, nodeOutputs);
            if (!whenResult) {
              const skippedOutput: NodeOutput = {
                state: "skipped",
                output: "",
              };
              nodeOutputs.set(node.id, skippedOutput);
              options.onNodeComplete?.(node.id, skippedOutput);
              return { node, output: skippedOutput };
            }
          } catch (whenErr) {
            const errorMessage =
              whenErr instanceof Error ? whenErr.message : String(whenErr);
            const failedOutput: NodeOutput = {
              state: "failed",
              output: "",
              error: errorMessage,
            };
            nodeOutputs.set(node.id, failedOutput);
            options.onNodeComplete?.(node.id, failedOutput);
            return { node, output: failedOutput };
          }
        }

        options.onNodeStart?.(node.id);

        // Execute node
        const context: DagContext = {
          workflowName,
          nodeOutputs,
          cwd,
          abortSignal: options.abortSignal,
        };

        const output = await executeNodeWithRetry(node, context, executor);
        nodeOutputs.set(node.id, output);
        options.onNodeComplete?.(node.id, output);

        // Cancel node handling: if any node fails and there's a cancel dependency,
        // downstream nodes will naturally fail via trigger_rule, but we also set
        // a global abort if the failed node is a cancel node.
        if (output.state === "failed" && isCancelNode(node)) {
          // Cancel nodes immediately fail the workflow
          throw new Error(`Cancel node '${node.id}' failed: ${output.error}`);
        }

        return { node, output };
      })
    );

    // Process layer results
    for (const result of layerResults) {
      if (result.status === "rejected") {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        return {
          success: false,
          nodeOutputs,
          durationMs: Date.now() - startTime,
          error: errorMessage,
        };
      }
    }

    // Check if abort was requested
    if (options.abortSignal?.aborted) {
      return {
        success: false,
        nodeOutputs,
        durationMs: Date.now() - startTime,
        error: "Aborted by abort signal",
      };
    }
  }

  // Determine overall success
  const anyFailed = Array.from(nodeOutputs.values()).some((o) => o.state === "failed");
  return {
    success: !anyFailed,
    nodeOutputs,
    durationMs: Date.now() - startTime,
  };
}
