import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PHASE_GATE_RULES } from "../core/phase-gates";

describe("README command guidance", () => {
  test("does not duplicate generated phase gate command chain", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("skills/gxpm/SKILL.md");
    expect(readme).toContain("core/phase-gates.ts");
    for (const rule of PHASE_GATE_RULES) {
      const demoCommand = rule.command.replace("gxpm ", "bin/gxpm ").replace("<issue-id>", "local-demo");
      expect(readme).not.toContain(demoCommand);
    }
  });
});
