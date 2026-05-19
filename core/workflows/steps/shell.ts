// SHELL STEP — execute an arbitrary shell command within a workflow.
// Captures stdout, stderr, and exitCode for downstream steps.

import { execSync } from "node:child_process";
import type { StepBase, StepResult, StepContext } from "../types";

export const ShellStep: StepBase = {
  typeKey: "shell",

  validate(config) {
    const errors: string[] = [];
    if (!config.command || typeof config.command !== "string") {
      errors.push("'command' is required and must be a string");
    }
    return errors;
  },

  execute(config, context) {
    const command = config.command as string;
    const cwd = config.cwd
      ? String(config.cwd).replace("${projectRoot}", context.projectRoot)
      : context.projectRoot;
    const capture = config.captureOutput !== false;
    const timeout = (config.timeout as number) || 60000;

    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
        timeout,
      });

      return {
        status: "completed",
        output: capture
          ? { stdout: output, exitCode: 0, command }
          : { exitCode: 0, command },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // execSync throws on non-zero exit; try to capture stdout/stderr from the error object
      const stdout =
        err && typeof err === "object" && "stdout" in err
          ? String((err as { stdout?: unknown }).stdout)
          : "";
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr?: unknown }).stderr)
          : "";
      const exitCode =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status?: unknown }).status)
          : 1;

      return {
        status: config.ignoreFailure ? "completed" : "failed",
        output: capture
          ? { stdout, stderr, exitCode, command }
          : { exitCode, command },
        error: errorMessage,
      };
    }
  },
};
