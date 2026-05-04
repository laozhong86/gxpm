import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTemplates } from "../scripts/discover-skills";

describe("discoverTemplates", () => {
  test("finds skill templates under skills/ while skipping hidden and build dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-discover-"));
    mkdirSync(join(root, "skills"));
    mkdirSync(join(root, "skills", "gxpm"), { recursive: true });
    writeFileSync(join(root, "skills", "gxpm", "SKILL.md.tmpl"), "gxpm");
    mkdirSync(join(root, "skills", ".agents"), { recursive: true });
    writeFileSync(join(root, "skills", ".agents", "SKILL.md.tmpl"), "hidden");
    mkdirSync(join(root, "skills", "dist"), { recursive: true });
    writeFileSync(join(root, "skills", "dist", "SKILL.md.tmpl"), "dist");
    // Files outside skills/ should be ignored
    writeFileSync(join(root, "SKILL.md.tmpl"), "root");
    mkdirSync(join(root, ".agents"), { recursive: true });
    writeFileSync(join(root, ".agents", "SKILL.md.tmpl"), "hidden");

    expect(discoverTemplates(root)).toEqual([
      { tmpl: "skills/gxpm/SKILL.md.tmpl", output: "skills/gxpm/SKILL.md", name: "gxpm" },
    ]);
  });

  test("discovers references/ and scripts/ alongside skill templates", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-discover-"));
    mkdirSync(join(root, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "my-skill", "SKILL.md"), "my-skill");
    mkdirSync(join(root, "skills", "my-skill", "references"), { recursive: true });
    writeFileSync(join(root, "skills", "my-skill", "references", "guide.md"), "guide");
    mkdirSync(join(root, "skills", "my-skill", "scripts"), { recursive: true });
    writeFileSync(join(root, "skills", "my-skill", "scripts", "helper.ts"), "helper");

    expect(discoverTemplates(root)).toEqual([
      {
        tmpl: "skills/my-skill/SKILL.md",
        output: "skills/my-skill/SKILL.md",
        name: "my-skill",
        references: ["skills/my-skill/references/guide.md"],
        scripts: ["skills/my-skill/scripts/helper.ts"],
      },
    ]);
  });
});
