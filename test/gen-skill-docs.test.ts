import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHostConfig } from "../hosts";
import { generateSkillDocs, renderSkillContentForHost } from "../scripts/gen-skill-docs";

describe("generateSkillDocs", () => {
  test("renders templates with a generated header and host-aware preamble", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-gen-"));
    mkdirSync(join(root, "skills", "gxpm"), { recursive: true });
    writeFileSync(
      join(root, "skills", "gxpm", "SKILL.md.tmpl"),
      [
        "---",
        "name: gxpm",
        "description: test",
        "---",
        "",
        "{{PREAMBLE}}",
        "",
        "# Body",
        "",
        "```bash",
        "{{ARTIFACT_READ_COMMANDS}}",
        "```",
        "",
        "{{PHASE_GATE_COMMANDS}}",
        "",
        "{{PHASE_TRANSITION_SUMMARY}}",
        "",
      ].join("\n"),
    );

    const outputs = generateSkillDocs({ root, host: "claude", dryRun: false });

    expect(outputs).toEqual(["skills/gxpm/SKILL.md"]);
    const generated = readFileSync(join(root, "skills", "gxpm", "SKILL.md"), "utf8");
    expect(generated).toContain("AUTO-GENERATED from SKILL.md.tmpl");
    expect(generated).toContain("GXPM_ROOT=");
    expect(generated).toContain("# Body");
    expect(generated).toContain("gxpm artifact read <issue-id> acceptance-contract");
    expect(generated).toContain("gxpm qa land <issue-id>");
    expect(generated).toContain("`qa -> land` is blocked until `land-findings` exists");
    expect(generated).not.toContain("{{");
  });

  test("generated gxpm skill keeps the phase map and required habits", () => {
    const root = join(import.meta.dir, "..");
    const generated = renderSkillContentForHost(root, getHostConfig("codex"), "skills/gxpm/SKILL.md.tmpl");

    expect(generated).toContain("## 阶段地图");
    expect(generated).toContain("`triage`: 澄清 issue");
    expect(generated).toContain("`land`: 合并/部署交接门");
    expect(generated).toContain("## 必需习惯");
    expect(generated).toContain("绝不从聊天记忆推断阶段");
    expect(generated).toContain("绝不跳过 artifact 回写");
  });

  test("generated gxpm skill keeps key rules and related skills", () => {
    const root = join(import.meta.dir, "..");
    const generated = renderSkillContentForHost(root, getHostConfig("codex"), "skills/gxpm/SKILL.md.tmpl");

    expect(generated).toContain("## 关键规则");
    expect(generated).toContain("### 状态优先");
    expect(generated).toContain("### Artifact 纪律");
    expect(generated).toContain("## 相关 Skills");
    expect(generated).toContain("`/gxpm-diagnose`");
    expect(generated).toContain("`/gxpm-grill`");
    expect(generated).toContain("`/gxpm-tdd`");
  });

  test("renders {{REFERENCE:name}} placeholders from references/", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ref-"));
    mkdirSync(join(root, "skills", "test-skill"), { recursive: true });
    writeFileSync(
      join(root, "skills", "test-skill", "SKILL.md.tmpl"),
      ["---", "name: test", "description: test", "---", "", "# Test", "", "{{REFERENCE:detail}}"].join("\n"),
    );
    mkdirSync(join(root, "skills", "test-skill", "references"), { recursive: true });
    writeFileSync(join(root, "skills", "test-skill", "references", "detail.md"), "Detailed content here.");

    const generated = renderSkillContentForHost(
      root,
      getHostConfig("codex"),
      "skills/test-skill/SKILL.md.tmpl",
      ["skills/test-skill/references/detail.md"],
    );

    expect(generated).toContain("Detailed content here.");
    expect(generated).not.toContain("{{REFERENCE:");
  });
});
