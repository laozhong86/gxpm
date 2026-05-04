/**
 * DAG Loader
 *
 * Validates DAG structure: unique IDs, dependency existence, cycle detection,
 * and $node_id.output reference integrity.
 */
import type {
  DagNode,
  WorkflowDefinition,
  WorkflowLoadError,
  ParseResult,
} from "./dag-schemas";

/**
 * Validate DAG structure and return an error string or null if valid.
 */
export function validateDagStructure(nodes: readonly DagNode[]): string | null {
  // Check ID uniqueness
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      return `Duplicate node id: '${node.id}'`;
    }
    ids.add(node.id);
  }

  // Check depends_on references exist
  for (const node of nodes) {
    for (const dep of node.depends_on ?? []) {
      if (!ids.has(dep)) {
        return `Node '${node.id}' depends_on unknown node '${dep}'`;
      }
    }
  }

  // Cycle detection via Kahn's algorithm
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

  const queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  let visited = 0;

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (nodeId === undefined) break;
    visited++;
    for (const dep of dependents.get(nodeId) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  if (visited < nodes.length) {
    const cycleNodes = nodes
      .filter((n) => (inDegree.get(n.id) ?? 0) > 0)
      .map((n) => n.id);
    return `Cycle detected among nodes: ${cycleNodes.join(", ")}`;
  }

  // Check $node_id.output references in when: and prompt: fields
  const outputRefPattern = /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output/g;
  const stripMarkdownCode = (s: string): string =>
    s.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

  for (const node of nodes) {
    const sources: string[] = [];
    if (node.when) sources.push(node.when);
    if ("prompt" in node && typeof node.prompt === "string") {
      sources.push(stripMarkdownCode(node.prompt));
    }
    for (const source of sources) {
      let m: RegExpExecArray | null;
      outputRefPattern.lastIndex = 0;
      while ((m = outputRefPattern.exec(source)) !== null) {
        const refNodeId = m[1];
        if (refNodeId !== undefined && !ids.has(refNodeId)) {
          return `Node '${node.id}' references unknown node '$${refNodeId}.output'`;
        }
      }
    }
  }

  return null;
}

/**
 * Parse a workflow definition from a plain object.
 * Does NOT parse YAML — caller handles deserialization.
 */
export function parseWorkflow(raw: unknown, filename = "workflow.json"): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      workflow: null,
      error: {
        filename,
        error: "Workflow must be a non-null object",
        errorType: "validation_error",
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== "string") {
    return {
      workflow: null,
      error: {
        filename,
        error: "Missing required field 'name'",
        errorType: "validation_error",
      },
    };
  }

  if (!obj.description || typeof obj.description !== "string") {
    return {
      workflow: null,
      error: {
        filename,
        error: "Missing required field 'description'",
        errorType: "validation_error",
      },
    };
  }

  if (!Array.isArray(obj.nodes)) {
    return {
      workflow: null,
      error: {
        filename,
        error: "Workflow must have 'nodes' array",
        errorType: "validation_error",
      },
    };
  }

  const nodes: DagNode[] = [];
  for (let i = 0; i < obj.nodes.length; i++) {
    const n = obj.nodes[i];
    if (!n || typeof n !== "object" || Array.isArray(n)) {
      return {
        workflow: null,
        error: {
          filename,
          error: `Node at index ${i} is not an object`,
          errorType: "validation_error",
        },
      };
    }
    const nodeObj = n as Record<string, unknown>;
    const id =
      typeof nodeObj.id === "string" && nodeObj.id.trim()
        ? nodeObj.id.trim()
        : `#${i + 1}`;

    const base: { id: string; depends_on?: string[]; trigger_rule?: string; when?: string } = {
      id,
    };

    if (Array.isArray(nodeObj.depends_on)) {
      base.depends_on = nodeObj.depends_on.filter(
        (d): d is string => typeof d === "string"
      );
    }
    if (typeof nodeObj.trigger_rule === "string") {
      base.trigger_rule = nodeObj.trigger_rule;
    }
    if (typeof nodeObj.when === "string") {
      base.when = nodeObj.when;
    }

    const type = nodeObj.type;
    if (type === "prompt") {
      if (typeof nodeObj.prompt !== "string") {
        return {
          workflow: null,
          error: {
            filename,
            error: `Node '${id}': prompt node requires 'prompt' string`,
            errorType: "validation_error",
          },
        };
      }
      nodes.push({
        ...base,
        type: "prompt",
        prompt: nodeObj.prompt,
        provider: typeof nodeObj.provider === "string" ? nodeObj.provider : undefined,
        model: typeof nodeObj.model === "string" ? nodeObj.model : undefined,
        systemPrompt: typeof nodeObj.systemPrompt === "string" ? nodeObj.systemPrompt : undefined,
        output_format:
          typeof nodeObj.output_format === "object" && nodeObj.output_format !== null
            ? (nodeObj.output_format as Record<string, unknown>)
            : undefined,
        maxBudgetUsd: typeof nodeObj.maxBudgetUsd === "number" ? nodeObj.maxBudgetUsd : undefined,
        allowed_tools: Array.isArray(nodeObj.allowed_tools)
          ? nodeObj.allowed_tools.filter((t): t is string => typeof t === "string")
          : undefined,
        denied_tools: Array.isArray(nodeObj.denied_tools)
          ? nodeObj.denied_tools.filter((t): t is string => typeof t === "string")
          : undefined,
      });
    } else if (type === "bash") {
      if (typeof nodeObj.bash !== "string") {
        return {
          workflow: null,
          error: {
            filename,
            error: `Node '${id}': bash node requires 'bash' string`,
            errorType: "validation_error",
          },
        };
      }
      nodes.push({ ...base, type: "bash", bash: nodeObj.bash });
    } else if (type === "script") {
      if (typeof nodeObj.script !== "string") {
        return {
          workflow: null,
          error: {
            filename,
            error: `Node '${id}': script node requires 'script' string`,
            errorType: "validation_error",
          },
        };
      }
      nodes.push({ ...base, type: "script", script: nodeObj.script });
    } else if (type === "phase") {
      if (typeof nodeObj.phase !== "string") {
        return {
          workflow: null,
          error: {
            filename,
            error: `Node '${id}': phase node requires 'phase' string`,
            errorType: "validation_error",
          },
        };
      }
      nodes.push({ ...base, type: "phase", phase: nodeObj.phase });
    } else if (type === "approval") {
      nodes.push({
        ...base,
        type: "approval",
        message: typeof nodeObj.message === "string" ? nodeObj.message : undefined,
      });
    } else if (type === "cancel") {
      nodes.push({ ...base, type: "cancel" });
    } else {
      return {
        workflow: null,
        error: {
          filename,
          error: `Node '${id}': unknown or missing type '${type}'`,
          errorType: "validation_error",
        },
      };
    }
  }

  const structureError = validateDagStructure(nodes);
  if (structureError) {
    return {
      workflow: null,
      error: {
        filename,
        error: structureError,
        errorType: "validation_error",
      },
    };
  }

  const workflow: WorkflowDefinition = {
    name: obj.name,
    description: obj.description,
    provider: typeof obj.provider === "string" ? obj.provider : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    nodes,
  };

  return { workflow, error: null };
}
