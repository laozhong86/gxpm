import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installKimiHooks } from "../scripts/install-kimi-hooks";

describe("installKimiHooks", () => {
  test("creates ~/.kimi/config.toml when missing", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-kimi-new-"));
    const result = installKimiHooks({ home: fakeHome });

    expect(result.rootDir).toBe(join(fakeHome, ".kimi"));
    expect(existsSync(result.configTomlPath)).toBe(true);

    const content = readFileSync(result.configTomlPath, "utf8");
    expect(content).toContain('event = "SessionStart"');
    expect(content).toContain('event = "UserPromptSubmit"');
    expect(content).toContain('event = "PreToolUse"');
    expect(content).toContain('command = "gxpm hook SessionStart --host kimi"');
    expect(content).toContain("# gxpm hooks");
    expect(content).toContain("# end gxpm hooks");
  });

  test("re-run is idempotent (replaces block, does not duplicate)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-kimi-idem-"));

    installKimiHooks({ home: fakeHome });
    installKimiHooks({ home: fakeHome });
    installKimiHooks({ home: fakeHome });

    const content = readFileSync(join(fakeHome, ".kimi", "config.toml"), "utf8");
    const starts = content.split("# gxpm hooks").length - 1;
    const ends = content.split("# end gxpm hooks").length - 1;
    expect(starts).toBe(1);
    expect(ends).toBe(1);
  });

  test("preserves existing config.toml content", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-kimi-preserve-"));
    const kimiDir = join(fakeHome, ".kimi");
    mkdirSync(kimiDir, { recursive: true });
    writeFileSync(
      join(kimiDir, "config.toml"),
      "[agent]\nmodel = \"kimi-k2\"\n\n[model]\ntemperature = 0.7\n",
    );

    installKimiHooks({ home: fakeHome });

    const content = readFileSync(join(kimiDir, "config.toml"), "utf8");
    expect(content).toContain('[agent]\nmodel = "kimi-k2"');
    expect(content).toContain("temperature = 0.7");
    expect(content).toContain('event = "SessionStart"');
  });

  test("replaces existing gxpm block while keeping user content", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-kimi-replace-"));
    const kimiDir = join(fakeHome, ".kimi");
    mkdirSync(kimiDir, { recursive: true });
    writeFileSync(
      join(kimiDir, "config.toml"),
      '[agent]\nmodel = "kimi-k2"\n\n# gxpm hooks (managed by gxpm init) — do not edit manually\n[[hooks]]\nevent = "SessionStart"\ncommand = "old-command"\n# end gxpm hooks\n',
    );

    installKimiHooks({ home: fakeHome });

    const content = readFileSync(join(kimiDir, "config.toml"), "utf8");
    expect(content).toContain('[agent]\nmodel = "kimi-k2"');
    expect(content).not.toContain("old-command");
    expect(content).toContain('command = "gxpm hook SessionStart --host kimi"');
  });

  test("matcher values are appropriate for Kimi", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-kimi-matchers-"));
    installKimiHooks({ home: fakeHome });

    const content = readFileSync(join(fakeHome, ".kimi", "config.toml"), "utf8");
    expect(content).toContain('matcher = ""');
    expect(content).toContain('matcher = "edit_file|write_file"');
  });
});
