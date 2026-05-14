import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installSkill } from "../scripts/install-skill";

const repoRoot = resolve(import.meta.dir, "..");

describe("installSkill", () => {
  test("installs SKILL.md to codex host's globalRoot", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-codex-"));
    const installed = installSkill({ hostName: "codex", root: repoRoot, home: fakeHome });

    // Batch install: gxpm main skill + code-intelligence skills
    expect(installed.length).toBeGreaterThanOrEqual(1);
    const expectedPath = join(fakeHome, ".codex", "skills", "gxpm", "SKILL.md");
    expect(installed).toContain(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, "utf8");
    expect(content).toContain("name: gxpm");
    expect(content).toContain("Target host: OpenAI Codex CLI");
    expect(content).toContain("GXPM_STATE_DIR");
  });

  test("installs SKILL.md to claude host's globalRoot", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-claude-"));
    const installed = installSkill({ hostName: "claude", root: repoRoot, home: fakeHome });

    // Batch install: gxpm main skill + code-intelligence skills
    expect(installed.length).toBeGreaterThanOrEqual(1);
    const expectedPath = join(fakeHome, ".claude", "skills", "gxpm", "SKILL.md");
    expect(installed).toContain(expectedPath);
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
    expect(installed.some((p) => p.includes(".cursor/skills/gxpm"))).toBe(true);
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

  test("installs references/ alongside SKILL.md from repository skills", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-refs-"));
    const installed = installSkill({ hostName: "codex", root: repoRoot, home: fakeHome });

    // gxpm-grill should have references installed
    const grillRefPath = join(fakeHome, ".codex", "skills", "gxpm-grill", "references", "process.md");
    expect(installed).toContain(grillRefPath);
    expect(existsSync(grillRefPath)).toBe(true);

  });

  test("does not create scripts/ when a skill has no script assets", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-install-skill-no-scripts-root-"));
    mkdirSync(join(root, "skills", "my-skill"), { recursive: true });
    writeFileSync(
      join(root, "skills", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: fixture skill\n---\n# My Skill\n",
    );

    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-no-scripts-"));
    const installed = installSkill({ hostName: "codex", root, home: fakeHome });

    const installedScriptsDir = join(fakeHome, ".codex", "skills", "my-skill", "scripts");
    expect(installed).not.toContain(installedScriptsDir);
    expect(existsSync(installedScriptsDir)).toBe(false);
  });

  test("installs scripts/ alongside SKILL.md when a skill owns script assets", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-install-skill-script-root-"));
    mkdirSync(join(root, "skills", "my-skill", "scripts"), { recursive: true });
    writeFileSync(
      join(root, "skills", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: fixture skill\n---\n# My Skill\n",
    );
    writeFileSync(join(root, "skills", "my-skill", "scripts", "helper.ts"), "console.log('helper');\n");

    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-install-skill-scripts-"));
    const installed = installSkill({ hostName: "codex", root, home: fakeHome });

    const scriptPath = join(fakeHome, ".codex", "skills", "my-skill", "scripts", "helper.ts");
    expect(installed).toContain(scriptPath);
    expect(existsSync(scriptPath)).toBe(true);
    expect(readFileSync(scriptPath, "utf8")).toBe("console.log('helper');\n");
  });
});
