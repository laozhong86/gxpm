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

  test("generated gxpm skill keeps the task intake brainstorming gate", () => {
    const root = join(import.meta.dir, "..");
    const generated = renderSkillContentForHost(root, getHostConfig("codex"), "skills/gxpm/SKILL.md.tmpl");

    expect(generated).toContain("## Task Intake / Brainstorming Gate");
    expect(generated).toContain("Codex `request_user_input`");
    expect(generated).toContain("External tracking ids are not gxpm issue ids");
    expect(generated).toContain("`gxpm issue create --auto-id`");
    expect(generated).toContain("## Issue Types");
    expect(generated).toContain("gxpm issue create --auto-id --type meta");
  });

  test("generated gxpm skill documents cmux browser investigation rules", () => {
    const root = join(import.meta.dir, "..");
    const generated = renderSkillContentForHost(root, getHostConfig("codex"), "skills/gxpm/SKILL.md.tmpl");

    expect(generated).toContain("## Browser Investigation (cmux session only)");
    expect(generated).toContain("CMUX_SURFACE_ID");
    expect(generated).toContain("snapshot refs are ephemeral");
    expect(generated).toContain("Unsupported browser subcommand");
    expect(generated).toContain("not_supported on WKWebView");
    expect(generated).toContain("agent-browser");
    expect(generated).toContain("disclosure-only click after explicit user confirmation");
  });
});
