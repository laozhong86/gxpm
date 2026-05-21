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
    // Both entrypoints must surface the shared scaffold check line. The
    // `scripts/gxpm-check.ts` wrapper additionally runs check-cli-promises
    // (GXPM-139), so its output is a superset of `gxpm check` rather than an
    // exact match.
    expect(output(cliCheck)).toContain("gxpm scaffold check passed (3 hosts)");
    expect(output(configCheck)).toContain("gxpm scaffold check passed (3 hosts)");
    expect(output(configCheck)).toContain("check-cli-promises");
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

  // GXPM-185: bare `gxpm` invocation must route to help, not scaffold-check.
  // Background: 0.2.0 / 0.2.1 dumped scaffold-check output (and worse, skill
  // structure warnings for external consumers) whenever a user typed `gxpm`
  // alone. First-contact UX disaster — looks like errors when none exist.
  test("bare gxpm invocation prints help banner, not scaffold-check output", () => {
    const externalCwd = mkdtempSync(join(tmpdir(), "gxpm-bare-extern-"));
    const result = runScript([cliPath], externalCwd);
    expect(result.exitCode).toBe(0);
    const combined = output(result);
    // Must show the discovery banner — Commands: / Usage: are stable headings
    // in getTopLevelUsage().
    expect(combined).toContain("Usage:");
    expect(combined).toContain("Commands:");
    // Must NOT route through runScaffoldCheck() — its signature line and the
    // skill-structure warnings it can emit are both forbidden here.
    expect(combined).not.toContain("gxpm scaffold check passed");
    expect(combined).not.toContain("[skill-naming]");
    expect(combined).not.toContain("SKILL.md structure warnings:");
  });
});
