import { describe, expect, test } from "bun:test";
import { runScaffoldCheck } from "../scripts/scaffold-check";
import { output, runScript } from "./helpers/workflow";

describe("scaffold check", () => {
  test("reports the shared scaffold check result", () => {
    expect(runScaffoldCheck()).toBe("gxpm scaffold check passed (2 hosts)");
  });

  test("keeps gxpm check and gxpm-check entrypoints aligned", () => {
    const cliCheck = runScript(["scripts/gxpm.ts", "check"]);
    const configCheck = runScript(["scripts/gxpm-check.ts"]);

    expect(cliCheck.exitCode).toBe(0);
    expect(configCheck.exitCode).toBe(0);
    expect(output(cliCheck)).toBe(output(configCheck));
    expect(output(cliCheck)).toContain("gxpm scaffold check passed (2 hosts)");
  });
});
