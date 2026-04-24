import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSkillDocs } from "../scripts/gen-skill-docs";

describe("generateSkillDocs", () => {
  test("renders templates with a generated header and host-aware preamble", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gen-"));
    mkdirSync(join(root, "skills", "gxpm"), { recursive: true });
    writeFileSync(
      join(root, "skills", "gxpm", "SKILL.md.tmpl"),
      "---\nname: gxpm\ndescription: test\n---\n\n{{PREAMBLE}}\n\n# Body\n",
    );

    const outputs = generateSkillDocs({ root, host: "claude", dryRun: false });

    expect(outputs).toEqual(["skills/gxpm/SKILL.md"]);
    const generated = readFileSync(join(root, "skills", "gxpm", "SKILL.md"), "utf8");
    expect(generated).toContain("AUTO-GENERATED from SKILL.md.tmpl");
    expect(generated).toContain("GXPM_ROOT=");
    expect(generated).toContain("# Body");
  });
});
