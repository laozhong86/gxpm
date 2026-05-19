import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClaudeHooks } from "../scripts/install-claude-hooks";

describe("installClaudeHooks", () => {
  test("default scope is 'repo' (writes to <target>/.claude/)", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-claude-default-"));
    const result = installClaudeHooks({ target: fakeRepo });
    expect(result.rootDir).toBe(join(fakeRepo, ".claude"));
    expect(existsSync(join(fakeRepo, ".claude", "settings.json"))).toBe(true);
  });

  test("user scope: writes settings.json to ~/.claude/", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-hooks-user-"));

    const result = installClaudeHooks({ scope: "user", home: fakeHome });

    expect(result.rootDir).toBe(join(fakeHome, ".claude"));
    expect(existsSync(join(fakeHome, ".claude", "settings.json"))).toBe(true);

    const cfg = JSON.parse(readFileSync(result.settingsJsonPath, "utf8"));
    expect(cfg.hooks.SessionStart).toBeDefined();
    expect(cfg.hooks.UserPromptSubmit).toBeDefined();
    expect(cfg.hooks.PreToolUse).toBeDefined();
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toBe("gxpm hook SessionStart --host claude");
    expect(cfg.hooks.UserPromptSubmit[0].hooks[0].command).toBe("gxpm hook UserPromptSubmit --host claude");
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toBe("gxpm hook PreToolUse --host claude");
  });

  test("repo scope: writes settings.json to <target>/.claude/", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-claude-hooks-repo-"));

    const result = installClaudeHooks({ scope: "repo", target: fakeRepo });

    expect(result.rootDir).toBe(join(fakeRepo, ".claude"));
    expect(existsSync(join(fakeRepo, ".claude", "settings.json"))).toBe(true);
  });

  test("SessionStart matcher filters startup|clear|compact", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-matcher-"));
    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(cfg.hooks.SessionStart[0].matcher).toBe("startup|clear|compact");
    expect(cfg.hooks.PreToolUse[0].matcher).toBe("ExitPlanMode");
  });

  test("UserPromptSubmit has no matcher", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-no-matcher-"));
    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(cfg.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
  });

  test("all hooks are synchronous (async: false)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-async-"));
    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(cfg.hooks.SessionStart[0].hooks[0].async).toBe(false);
    expect(cfg.hooks.UserPromptSubmit[0].hooks[0].async).toBe(false);
    expect(cfg.hooks.PreToolUse[0].hooks[0].async).toBe(false);
  });

  test("re-run is idempotent (does not duplicate entries)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-hooks-idem-"));

    installClaudeHooks({ scope: "user", home: fakeHome });
    installClaudeHooks({ scope: "user", home: fakeHome });
    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(cfg.hooks.SessionStart.length).toBe(1);
    expect(cfg.hooks.SessionStart[0].hooks.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit[0].hooks.length).toBe(1);
  });

  test("preserves unrelated user hooks in existing settings.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-hooks-merge-"));
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
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

    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    expect(cfg.hooks.Stop[0].hooks[0].command).toContain("notify-slack");
    const allCommands = cfg.hooks.SessionStart.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command),
    );
    expect(allCommands).toContain("/usr/local/bin/my-other-hook");
    expect(allCommands).toContain("gxpm hook SessionStart --host claude");
  });

  test("preserves non-hooks keys in existing settings.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-claude-preserve-"));
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ theme: "dark", autoUpdate: true }),
    );

    installClaudeHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    expect(cfg.theme).toBe("dark");
    expect(cfg.autoUpdate).toBe(true);
    expect(cfg.hooks.SessionStart).toBeDefined();
  });
});
