// GXPM STEP — invoke gxpm CLI commands within a workflow.

import { execSync } from "node:child_process";
import type { StepBase, StepResult, StepContext } from "../types";

export const GxpmStep: StepBase = {
  typeKey: "gxpm",

  validate(config) {
    const errors: string[] = [];
    if (!config.command || typeof config.command !== "string") {
      errors.push("'command' is required and must be a string");
    }
    return errors;
  },

  execute(config, context) {
    const command = config.command as string;
    const fullCommand = `bun run bin/gxpm ${command}`;
    const cwd = context.projectRoot;
    const capture = config.captureOutput !== false;

    try {
      const output = execSync(fullCommand, {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
        timeout: (config.timeout as number) || 120000,
      });

      return {
        status: "completed",
        output: capture ? { stdout: output, command: fullCommand } : { command: fullCommand },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        status: config.ignoreFailure ? "completed" : "failed",
        output: { command: fullCommand },
        error: errorMessage,
      };
    }
  },
};
