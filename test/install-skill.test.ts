import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installSkill } from "../scripts/install-skill";

const repoRoot = resolve(import.meta.dir, "..");

describe("installSkill", () => {
  test("installs SKILL.md to codex host's globalRoot", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-codex-"));
    const installed = installSkill({ hostName: "codex", root: repoRoot, home: fakeHome });

    expect(installed.length).toBe(1);
    const expectedPath = join(fakeHome, ".codex", "skills", "gxpm", "SKILL.md");
    expect(installed[0]).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, "utf8");
    expect(content).toContain("name: gxpm");
    expect(content).toContain("Target host: OpenAI Codex CLI");
    expect(content).toContain("GXPM_STATE_DIR");
  });

  test("installs SKILL.md to claude host's globalRoot", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-claude-"));
    const installed = installSkill({ hostName: "claude", root: repoRoot, home: fakeHome });

    expect(installed.length).toBe(1);
    const expectedPath = join(fakeHome, ".claude", "skills", "gxpm", "SKILL.md");
    expect(installed[0]).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, "utf8");
    expect(content).toContain("Target host: Claude Code");
    // claude.ts has usesEnvVars=false → no GXPM_STATE_DIR line
    expect(content).not.toContain("GXPM_STATE_DIR");
  });

  test("install host=all writes to all known hosts", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-all-"));
    const installed = installSkill({ hostName: "all", root: repoRoot, home: fakeHome });

    expect(installed.length).toBeGreaterThanOrEqual(2);
    expect(installed.some((p) => p.includes(".codex/skills/gxpm"))).toBe(true);
    expect(installed.some((p) => p.includes(".claude/skills/gxpm"))).toBe(true);
  });

  test("default hostName installs to all hosts", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-default-"));
    const installed = installSkill({ root: repoRoot, home: fakeHome });

    expect(installed.length).toBeGreaterThanOrEqual(2);
  });

  test("unknown host throws", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-unknown-"));
    expect(() =>
      installSkill({ hostName: "kuro", root: repoRoot, home: fakeHome }),
    ).toThrow("Unknown gxpm host");
  });
});
