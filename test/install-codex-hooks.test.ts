import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installCodexHooks } from "../scripts/install-codex-hooks";

const repoRoot = resolve(import.meta.dir, "..");

describe("installCodexHooks", () => {
  test("default scope is 'repo' (writes to <target>/.codex/)", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-default-"));
    const result = installCodexHooks({ target: fakeRepo });
    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("user scope: writes hooks.json to ~/.codex/", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-user-"));

    const result = installCodexHooks({ scope: "user", home: fakeHome });

    expect(result.rootDir).toBe(join(fakeHome, ".codex"));
    expect(existsSync(join(fakeHome, ".codex", "hooks.json"))).toBe(true);

    const cfg = JSON.parse(readFileSync(result.hooksJsonPath, "utf8"));
    expect(cfg.hooks.SessionStart).toBeDefined();
    expect(cfg.hooks.UserPromptSubmit).toBeDefined();
    expect(cfg.hooks.PreToolUse).toBeDefined();
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toBe("gxpm hook SessionStart --host codex");
    expect(cfg.hooks.UserPromptSubmit[0].hooks[0].command).toBe("gxpm hook UserPromptSubmit --host codex");
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toBe("gxpm hook PreToolUse --host codex");
  });

  test("repo scope: writes hooks.json to <target>/.codex/", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-repo-"));

    const result = installCodexHooks({ scope: "repo", target: fakeRepo });

    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("registers PreToolUse hook for update_plan recording", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-pretool-config-"));
    installCodexHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".codex", "hooks.json"), "utf8"));
    expect(cfg.hooks.PreToolUse).toBeDefined();
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toBe("gxpm hook PreToolUse --host codex");
  });

  test("re-run is idempotent (does not duplicate entries)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-idem-"));

    installCodexHooks({ scope: "user", home: fakeHome });
    installCodexHooks({ scope: "user", home: fakeHome });
    installCodexHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".codex", "hooks.json"), "utf8"));
    expect(cfg.hooks.SessionStart.length).toBe(1);
    expect(cfg.hooks.SessionStart[0].hooks.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit[0].hooks.length).toBe(1);
  });

  test("auto-enables codex_hooks feature flag in ~/.codex/config.toml when missing", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-add-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(
      join(codexDir, "config.toml"),
      'model = "gpt-5.5"\n\n[features]\nfast_mode = true\n',
    );

    const result = installCodexHooks({ scope: "user", home: fakeHome });
    expect(result.featureFlagEnabled).toBe("enabled-now");

    const cfg = readFileSync(join(codexDir, "config.toml"), "utf8");
    expect(cfg).toMatch(/codex_hooks\s*=\s*true/);
    expect(cfg).toMatch(/fast_mode\s*=\s*true/); // existing flag preserved
  });

  test("does not re-enable codex_hooks if already true (idempotent)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-already-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(join(codexDir, "config.toml"), "[features]\ncodex_hooks = true\n");

    const result = installCodexHooks({ scope: "user", home: fakeHome });
    expect(result.featureFlagEnabled).toBe("already-set");
  });

  test("--no-feature-flag option skips feature flag mutation", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-skip-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(join(codexDir, "config.toml"), 'model = "x"\n');

    const result = installCodexHooks({
      scope: "user", home: fakeHome, enableFeatureFlag: false,
    });
    expect(result.featureFlagEnabled).toBe("skipped");

    const cfg = readFileSync(join(codexDir, "config.toml"), "utf8");
    expect(cfg).not.toMatch(/codex_hooks/);
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

    installCodexHooks({ scope: "user", home: fakeHome });

    const cfg = JSON.parse(readFileSync(join(codexDir, "hooks.json"), "utf8"));
    // Other Stop hooks preserved
    expect(cfg.hooks.Stop[0].hooks[0].command).toContain("notify-slack");
    // User's own SessionStart preserved alongside ours
    const allCommands = cfg.hooks.SessionStart.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command),
    );
    expect(allCommands).toContain("/usr/local/bin/my-other-hook");
    expect(allCommands).toContain("gxpm hook SessionStart --host codex");
  });
});
