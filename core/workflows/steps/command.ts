// COMMAND STEP — execute a shell command.

import { execSync } from "node:child_process";
import type { StepBase, StepResult, StepContext } from "../types";

export const CommandStep: StepBase = {
  typeKey: "command",

  validate(config) {
    const errors: string[] = [];
    if (!config.command || typeof config.command !== "string") {
      errors.push("'command' is required and must be a string");
    }
    return errors;
  },

  execute(config, context) {
    const command = config.command as string;
    const cwd = config.cwd ? String(config.cwd).replace("${projectRoot}", context.projectRoot) : context.projectRoot;
    const capture = config.captureOutput !== false;

    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
        timeout: (config.timeout as number) || 60000,
      });

      return {
        status: "completed",
        output: capture ? { stdout: output, command } : { command },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        status: config.ignoreFailure ? "completed" : "failed",
        output: { command },
        error: errorMessage,
      };
    }
  },
};
