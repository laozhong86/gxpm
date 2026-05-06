// EXPRESSION ENGINE — minimal Jinja2-like evaluator.
// Supports variable interpolation ${var} and simple conditions.
// NO eval / new Function. Whitelist only.

import type { StepContext } from "./types";

const ALLOWED_NAMESPACES = new Set([
  "inputs",
  "steps",
  "issue",
  "artifacts",
  "item",
  "fan_in",
  "env",
]);

export function evaluateExpression(template: string, context: StepContext): unknown {
  // Simple variable interpolation: ${namespace.key} or ${namespace.key.subkey}
  const interpolated = template.replace(/\$\{([^}]+)\}/g, (_match, path) => {
    const value = resolvePath(path.trim(), context);
    return value !== undefined ? String(value) : "";
  });
  return interpolated;
}

export function evaluateCondition(condition: string, context: StepContext): boolean {
  const evaluated = evaluateExpression(condition, context);
  if (typeof evaluated === "boolean") return evaluated;
  if (typeof evaluated === "string") {
    const normalized = evaluated.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  if (typeof evaluated === "number") return evaluated !== 0;
  return Boolean(evaluated);
}

function resolvePath(path: string, context: StepContext): unknown {
  const parts = path.split(".");
  const namespace = parts[0];

  if (!ALLOWED_NAMESPACES.has(namespace)) {
    return undefined;
  }

  let value: unknown;
  switch (namespace) {
    case "inputs":
      value = context.inputs;
      break;
    case "steps":
      value = context.steps;
      break;
    case "item":
      value = context.item;
      break;
    case "fan_in":
      value = context.fanIn;
      break;
    case "env":
      value = process.env;
      break;
    default:
      return undefined;
  }

  for (let i = 1; i < parts.length; i++) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "object") {
      value = (value as Record<string, unknown>)[parts[i]];
    } else {
      return undefined;
    }
  }

  return value;
}
