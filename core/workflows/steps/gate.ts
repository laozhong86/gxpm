// GATE STEP — pause workflow execution for human review/approval.
// When the engine reaches a gate step, it persists state and returns
// status "paused". The workflow can be resumed via `gxpm workflow resume`.

import type { StepBase, StepResult, StepContext } from "../types";

export const GateStep: StepBase = {
  typeKey: "gate",

  validate(config) {
    const errors: string[] = [];
    if (!config.message || typeof config.message !== "string") {
      errors.push("'message' is required and must be a string");
    }
    return errors;
  },

  execute(config, context) {
    const message = config.message as string;
    const condition = config.condition as string | undefined;

    // If a condition is provided and evaluates to false, skip the gate
    if (condition) {
      const { evaluateCondition } = require("../expressions");
      const shouldGate = evaluateCondition(condition, context);
      if (!shouldGate) {
        return {
          status: "skipped",
          output: { message, reason: "condition evaluated to false" },
        };
      }
    }

    return {
      status: "paused",
      output: {
        message,
        runId: context.runId,
        pausedAt: new Date().toISOString(),
      },
    };
  },

  canResume() {
    return true;
  },
};
