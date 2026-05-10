import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runScaffoldCheck, validateLayeredWorkflowContracts } from "../scripts/scaffold-check";
import { output, runScript } from "./helpers/workflow";

const cliPath = resolve(import.meta.dir, "..", "scripts", "gxpm.ts");

describe("scaffold check", () => {
  test("reports the shared scaffold check result", () => {
    expect(runScaffoldCheck()).toBe("gxpm scaffold check passed (3 hosts)");
  });

  test("keeps layered workflow contracts aligned", () => {
    expect(validateLayeredWorkflowContracts()).toEqual([]);
  });

  test("keeps gxpm check and gxpm-check entrypoints aligned", () => {
    const cliCheck = runScript(["scripts/gxpm.ts", "check"]);
    const configCheck = runScript(["scripts/gxpm-check.ts"]);

    expect(cliCheck.exitCode).toBe(0);
    expect(configCheck.exitCode).toBe(0);
    expect(output(cliCheck)).toBe(output(configCheck));
    expect(output(cliCheck)).toContain("gxpm scaffold check passed (3 hosts)");
  });

  test("passes when CLI is invoked from outside the gxpm repo", () => {
    // Reproduces the bug report: 'gxpm check' run from another git repo
    // previously printed bogus 'missing governance doc' errors because it
    // resolved root from process.cwd() instead of the gxpm repo itself.
    const externalCwd = mkdtempSync(join(tmpdir(), "gxpm-check-extern-"));
    const result = runScript([cliPath, "check"], externalCwd);
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("gxpm scaffold check passed (3 hosts)");
  });
});
