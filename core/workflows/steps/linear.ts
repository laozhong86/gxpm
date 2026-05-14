// LINEAR STEP — interact with Linear issues.
// Thin wrapper; actual Linear integration delegates to existing core/linear module.

import type { StepBase, StepResult, StepContext } from "../types";

export const LinearStep: StepBase = {
  typeKey: "linear",

  validate(config) {
    const errors: string[] = [];
    if (!config.action || typeof config.action !== "string") {
      errors.push("'action' is required");
    }
    const valid = ["create", "update", "list", "transition"];
    if (!valid.includes(config.action as string)) {
      errors.push(`'action' must be one of: ${valid.join(", ")}`);
    }
    return errors;
  },

  async execute(config, _context) {
    const action = config.action as string;

    // Placeholder: will delegate to core/linear.ts when available
    // For now, return a mock result to keep workflow engine testable
    return {
      status: "completed",
      output: { action, mock: true, id: config.id as string },
    };
  },
};
