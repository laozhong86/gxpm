import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const uninstallBin = join(repoRoot, "bin", "gxpm-uninstall");

function seedInstall(home: string, target: string) {
  mkdirSync(join(home, ".codex", "skills", "gxpm"), { recursive: true });
  mkdirSync(join(home, ".claude", "skills", "gxpm"), { recursive: true });
  mkdirSync(join(home, ".gxpm"), { recursive: true });
  writeFileSync(join(home, ".codex", "skills", "gxpm", "SKILL.md"), "codex");
  writeFileSync(join(home, ".claude", "skills", "gxpm", "SKILL.md"), "claude");
  writeFileSync(join(home, ".gxpm", "last-update-check"), "UP_TO_DATE 0.1.0.0\n");

  mkdirSync(join(target, ".githooks"), { recursive: true });
  writeFileSync(join(target, ".githooks", "pre-commit"), "# gxpm dispatcher\n");
  writeFileSync(join(target, ".githooks", "gxpm-pre-commit"), "# gxpm hook\n");

  mkdirSync(join(target, ".codex", "hooks"), { recursive: true });
  writeFileSync(join(target, ".codex", "hooks", "gxpm-session-start.sh"), "# gxpm hook\n");
  writeFileSync(
    join(target, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "/tmp/gxpm-session-start.sh" },
              { type: "command", command: "gxpm hook SessionStart --host codex" },
              { type: "command", command: "/tmp/other-hook" },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              { type: "command", command: "gxpm hook Stop --host codex" },
            ],
          },
        ],
      },
    }, null, 2),
  );
}

function runUninstall(args: string[]) {
  return Bun.spawnSync({
    cmd: [uninstallBin, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("gxpm-uninstall", () => {
  test("--dry-run lists paths without deleting", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-uninstall-home-"));
    const target = mkdtempSync(join(tmpdir(), "gxpm-uninstall-target-"));
    seedInstall(home, target);

    const result = runUninstall(["--dry-run", "--home", home, "--target", target]);
    const out = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(out).toContain(join(home, ".codex", "skills", "gxpm"));
    expect(out).toContain(join(home, ".claude", "skills", "gxpm"));
    expect(out).toContain(join(target, ".githooks", "pre-commit"));
    expect(out).toContain(join(target, ".codex", "hooks", "gxpm-session-start.sh"));
    expect(existsSync(join(home, ".codex", "skills", "gxpm", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".githooks", "gxpm-pre-commit"))).toBe(true);
  });

  test("removes skills and repo hooks but preserves ~/.gxpm by default", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-uninstall-run-home-"));
    const target = mkdtempSync(join(tmpdir(), "gxpm-uninstall-run-target-"));
    seedInstall(home, target);

    const result = runUninstall(["--home", home, "--target", target]);
    const hooksJson = JSON.parse(readFileSync(join(target, ".codex", "hooks.json"), "utf8"));

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, ".codex", "skills", "gxpm"))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "gxpm"))).toBe(false);
    expect(existsSync(join(target, ".githooks", "gxpm-pre-commit"))).toBe(false);
    expect(existsSync(join(target, ".codex", "hooks", "gxpm-session-start.sh"))).toBe(false);
    expect(existsSync(join(home, ".gxpm", "last-update-check"))).toBe(true);
    expect(hooksJson.hooks.SessionStart[0].hooks).toEqual([{ type: "command", command: "/tmp/other-hook" }]);
    expect(hooksJson.hooks.Stop).toBeUndefined();
  });

  test("--purge removes ~/.gxpm state directory", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-uninstall-purge-home-"));
    const target = mkdtempSync(join(tmpdir(), "gxpm-uninstall-purge-target-"));
    seedInstall(home, target);

    const result = runUninstall(["--home", home, "--target", target, "--purge"]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, ".gxpm"))).toBe(false);
  });
});
