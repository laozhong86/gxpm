import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkCliPromises, formatCheckResult } from "../scripts/check-cli-promises";

const REAL_REPO = new URL("../", import.meta.url).pathname;

describe("GXPM-139 / scn-02 + scn-03: check-cli-promises", () => {
  test("current repo passes — every advertised command is registered", () => {
    const result = checkCliPromises(REAL_REPO);
    expect(result.ok).toBe(true);
    expect(result.inspected.length).toBeGreaterThan(0);
  });

  test("ghost command surfaces as missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-cli-promise-"));
    mkdirSync(join(tmp, "scripts/commands"), { recursive: true });
    mkdirSync(join(tmp, "core"), { recursive: true });
    mkdirSync(join(tmp, "scripts"), { recursive: true });
    // Minimal router with a real subcommand only
    writeFileSync(join(tmp, "scripts/gxpm.ts"), `
      if (command === "artifact") {}
      if (command === "issue") {}
    `);
    writeFileSync(join(tmp, "scripts/commands/issue.ts"), `
      // pretend we advertise a ghost command
      console.log("Next: gxpm phantomthing init <id>");
    `);
    writeFileSync(join(tmp, "core/phase-gates.ts"), "// placeholder");
    writeFileSync(join(tmp, "core/phase-artifact.ts"), "// placeholder");
    writeFileSync(join(tmp, "scripts/phase-artifact-commands.ts"), "// placeholder");

    const result = checkCliPromises(tmp);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.command === "phantomthing")).toBe(true);
    const formatted = formatCheckResult(result);
    expect(formatted).toContain("phantomthing");
  });

  test("formatter returns success banner when ok", () => {
    const result = { ok: true, missing: [], inspected: ["scripts/commands/issue.ts"] };
    expect(formatCheckResult(result)).toContain("✅");
  });
});
