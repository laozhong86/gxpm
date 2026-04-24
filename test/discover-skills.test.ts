import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTemplates } from "../scripts/discover-skills";

describe("discoverTemplates", () => {
  test("finds root and one-level skill templates while skipping hidden and build dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-discover-"));
    writeFileSync(join(root, "SKILL.md.tmpl"), "root");
    mkdirSync(join(root, "skills"));
    mkdirSync(join(root, "skills", "gxpm"), { recursive: true });
    writeFileSync(join(root, "skills", "gxpm", "SKILL.md.tmpl"), "gxpm");
    mkdirSync(join(root, ".agents"), { recursive: true });
    writeFileSync(join(root, ".agents", "SKILL.md.tmpl"), "hidden");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "SKILL.md.tmpl"), "dist");

    expect(discoverTemplates(root)).toEqual([
      { tmpl: "SKILL.md.tmpl", output: "SKILL.md" },
      { tmpl: "skills/gxpm/SKILL.md.tmpl", output: "skills/gxpm/SKILL.md" },
    ]);
  });
});
