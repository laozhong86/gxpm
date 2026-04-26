import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installCodexHooks } from "../scripts/install-codex-hooks";

const repoRoot = resolve(import.meta.dir, "..");

describe("installCodexHooks", () => {
  test("default scope is 'repo' (writes to <target>/.codex/)", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-default-"));
    const result = installCodexHooks({ target: fakeRepo, gxpmRoot: repoRoot });
    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("user scope: writes scripts to ~/.codex/hooks/ and hooks.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-user-"));

    const result = installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    expect(result.installedScripts.length).toBe(2);
    expect(result.installedScripts.every((p) => p.includes(".codex/hooks/gxpm-"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh"))).toBe(true);
    expect(existsSync(result.hooksJsonPath)).toBe(true);

    const cfg = JSON.parse(readFileSync(result.hooksJsonPath, "utf8"));
    expect(cfg.hooks.SessionStart).toBeDefined();
    expect(cfg.hooks.UserPromptSubmit).toBeDefined();
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toContain("gxpm-session-start.sh");
  });

  test("repo scope: writes to <target>/.codex/", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-repo-"));

    const result = installCodexHooks({ scope: "repo", target: fakeRepo, gxpmRoot: repoRoot });

    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks", "gxpm-session-start.sh"))).toBe(true);
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("scripts are executable", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-perm-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const scriptPath = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");
    const mode = statSync(scriptPath).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  test("re-run is idempotent (does not duplicate entries)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-idem-"));

    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const cfg = JSON.parse(
      readFileSync(join(fakeHome, ".codex", "hooks.json"), "utf8"),
    );
    expect(cfg.hooks.SessionStart.length).toBe(1);
    expect(cfg.hooks.SessionStart[0].hooks.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit[0].hooks.length).toBe(1);
  });

  test("preserves unrelated user hooks in existing hooks.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-merge-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(
      join(codexDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: "/usr/local/bin/my-other-hook", timeout: 5 }],
            },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "/usr/local/bin/notify-slack", timeout: 5 }] },
          ],
        },
      }),
    );

    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const cfg = JSON.parse(readFileSync(join(codexDir, "hooks.json"), "utf8"));
    // Other Stop hooks preserved
    expect(cfg.hooks.Stop[0].hooks[0].command).toContain("notify-slack");
    // User's own SessionStart preserved alongside ours
    const allCommands = cfg.hooks.SessionStart.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command),
    );
    expect(allCommands).toContain("/usr/local/bin/my-other-hook");
    expect(allCommands.some((c: string) => c.includes("gxpm-session-start.sh"))).toBe(true);
  });
});

describe("hook script behavior", () => {
  test("session-start.sh emits no output when cwd has no .gxpm/issues", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-empty-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");

    const emptyCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-emptycwd-"));
    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: emptyCwd, hook_event_name: "SessionStart" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("session-start.sh emits additionalContext when issues exist", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-issues-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");

    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-repocwd-"));
    // Use full path to gxpm CLI to ensure it works regardless of PATH
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    Bun.spawnSync({ cmd: [gxpmBin, "issue", "create", "GXPM-77"], cwd: repoCwd });

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: repoCwd, hook_event_name: "SessionStart" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    if (out.trim() !== "") {
      const parsed = JSON.parse(out);
      expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("GXPM-77");
    }
  });

  test("user-prompt-submit.sh ignores prompts without issue refs", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-noref-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh");

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ cwd: "/tmp", prompt: "hello world, nothing to see" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });
});
