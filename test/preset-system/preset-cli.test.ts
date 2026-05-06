import { describe, it, expect } from "bun:test";
import { runPresetCommand } from "../../scripts/commands/preset";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Preset CLI", () => {
  it("init creates a preset directory and manifest", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-preset-cli-"));
    const originalCwd = process.cwd();
    process.chdir(tmp);

    try {
      runPresetCommand([], "init", "test-preset");
      const manifestPath = join(tmp, ".gxpm", "presets", "test-preset", "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.id).toBe("test-preset");
      expect(manifest.name).toBe("test-preset");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("add activates a preset", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-preset-cli-"));
    const originalCwd = process.cwd();
    process.chdir(tmp);

    try {
      // Init preset
      runPresetCommand([], "init", "alpha");
      // Add to active
      runPresetCommand([], "add", "alpha");

      const registryPath = join(tmp, ".gxpm", "presets", ".registry");
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      expect(registry.active).toContain("alpha");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("remove deactivates a preset", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-preset-cli-"));
    const originalCwd = process.cwd();
    process.chdir(tmp);

    try {
      runPresetCommand([], "init", "beta");
      runPresetCommand([], "add", "beta");
      runPresetCommand([], "remove", "beta");

      const registryPath = join(tmp, ".gxpm", "presets", ".registry");
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      expect(registry.active).not.toContain("beta");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("throws on unknown preset add", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gxpm-preset-cli-"));
    const originalCwd = process.cwd();
    process.chdir(tmp);

    try {
      expect(() => runPresetCommand([], "add", "nonexistent")).toThrow("not found");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
