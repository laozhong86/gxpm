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

    expect(generated).toContain("## Phase Map");
    expect(generated).toContain("`triage`: clarify issue");
    expect(generated).toContain("`land`: merge/deploy handoff gate");
    expect(generated).toContain("## Required Habit");
    expect(generated).toContain("Never infer phase from chat memory");
    expect(generated).toContain("Never skip artifact writeback");
  });

  test("generated gxpm skill keeps key rules and related skills", () => {
    const root = join(import.meta.dir, "..");
    const generated = renderSkillContentForHost(root, getHostConfig("codex"), "skills/gxpm/SKILL.md.tmpl");

    expect(generated).toContain("## Key Rules");
    expect(generated).toContain("### State First");
    expect(generated).toContain("### Artifact Discipline");
    expect(generated).toContain("## Related Skills");
    expect(generated).toContain("`/gxpm-diagnose`");
    expect(generated).toContain("`/gxpm-grill`");
    expect(generated).toContain("`/gxpm-tdd`");
  });
});
