import { describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { output, runCli } from "./helpers/workflow";

describe("skill governance — agent execution discipline", () => {
  const skillPath = join(import.meta.dir, "..", "skills", "gxpm", "SKILL.md");
  const skill = readFileSync(skillPath, "utf8");

  test("SKILL.md mandates issue next after issue creation (scn-01)", () => {
    expect(skill).toMatch(/创建 issue 后的第一步必须是 [`']gxpm issue next/i);
    expect(skill).toMatch(/不得自行拼凑.*非标准命令/i);
  });

  test("SKILL.md contains phase init command mapping table (scn-01)", () => {
    expect(skill).toContain("| triage | `gxpm triage init <issue-id>` | acceptance-contract |");
    expect(skill).toContain("| plan | `gxpm plan init <issue-id>` | implementation-plan |");
    expect(skill).toContain("| specify | `gxpm specify init <issue-id>` | behavior-spec |");
    expect(skill).toContain("| implement | `gxpm implement verify <issue-id>` | local-verify |");
  });

  test("SKILL.md prohibits direct artifact file editing (scn-02)", () => {
    expect(skill).toMatch(/NEVER\s+直接编辑/i);
    expect(skill).toMatch(/\.gxpm\/issues\/.*artifacts\/\*\.json/i);
    expect(skill).toMatch(/所有 artifact.*必须通过 CLI/i);
  });

  test("SKILL.md mandates stop-and-report on CLI gaps (scn-04)", () => {
    expect(skill).toMatch(/停止.*报告.*缺口/i);
    expect(skill).toMatch(/不得绕过.*直接写文件/i);
  });

  test("gxpm issue next outputs available init, write, and edit commands (scn-03)", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-commands-"));
    expect(runCli(root, ["issue", "create", "GXPM-SG-01"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "next", "GXPM-SG-01"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);

    expect(out).toContain("Available commands for triage:");
    expect(out).toContain("init:    gxpm triage init GXPM-SG-01");
    expect(out).toContain("write:   gxpm artifact write GXPM-SG-01 acceptance-contract --json '...'");
    expect(out).toContain("edit:    gxpm artifact edit GXPM-SG-01 acceptance-contract");
  });

  test("gxpm issue next still outputs commands when artifact already exists (scn-03)", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-existing-artifact-"));
    expect(runCli(root, ["issue", "create", "GXPM-SG-02"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-SG-02"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "next", "GXPM-SG-02"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);

    expect(out).toContain("Available commands for triage:");
    expect(out).toContain("init:    gxpm triage init GXPM-SG-02");
    expect(out).toContain("write:   gxpm artifact write GXPM-SG-02 acceptance-contract --json '...'");
    expect(out).toContain("edit:    gxpm artifact edit GXPM-SG-02 acceptance-contract");
    expect(out).toContain("gxpm issue transition GXPM-SG-02 plan");
  });
});
