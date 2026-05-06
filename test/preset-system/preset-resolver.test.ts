import { describe, it, expect, beforeEach } from "bun:test";
import { PresetResolver } from "../../core/preset-system/preset-resolver";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("PresetResolver", () => {
  let tmp: string;
  let resolver: PresetResolver;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gxpm-preset-"));
    resolver = new PresetResolver(tmp);
  });

  it("returns core content when no override or preset exists", () => {
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("core content");
    expect(result!.source).toBe("core");
    expect(result!.appliedPresets).toEqual([]);
  });

  it("returns override content when override file exists", () => {
    const overrideDir = join(tmp, ".gxpm", "overrides", "skills", "gxpm");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, "SKILL.md"), "override content");

    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("override content");
    expect(result!.source).toBe("override");
  });

  it("applies preset replace strategy", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "skills/gxpm/SKILL.md", strategy: "replace", source: "skill.md" }],
      }),
    );
    writeFileSync(join(presetDir, "skill.md"), "preset content");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("preset content");
    expect(result!.source).toBe("preset");
    expect(result!.appliedPresets).toEqual(["default"]);
  });

  it("applies preset prepend strategy", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "test.md", strategy: "prepend", source: "header.md" }],
      }),
    );
    writeFileSync(join(presetDir, "header.md"), "# Header");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("test.md", "body");
    expect(result!.content).toBe("# Header\nbody");
  });

  it("applies preset append strategy", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "test.md", strategy: "append", source: "footer.md" }],
      }),
    );
    writeFileSync(join(presetDir, "footer.md"), "# Footer");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("test.md", "body");
    expect(result!.content).toBe("body\n# Footer");
  });

  it("applies preset wrap strategy", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "test.md", strategy: "wrap", source: "wrapper.md" }],
      }),
    );
    writeFileSync(join(presetDir, "wrapper.md"), "<!-- wrap -->");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("test.md", "body");
    expect(result!.content).toBe("<!-- wrap -->\nbody\n<!-- wrap -->");
  });

  it("override takes precedence over preset", () => {
    const overrideDir = join(tmp, ".gxpm", "overrides");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, "test.md"), "override");

    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "test.md", strategy: "replace", source: "preset.md" }],
      }),
    );
    writeFileSync(join(presetDir, "preset.md"), "preset");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("test.md", "core");
    expect(result!.content).toBe("override");
    expect(result!.source).toBe("override");
  });

  it("returns null when no content at any layer", () => {
    resolver.load();
    const result = resolver.resolve("nonexistent.md");
    expect(result).toBeNull();
  });

  it("supports wildcard target matching", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "default");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({
        id: "default",
        name: "Default",
        version: "1.0.0",
        rules: [{ target: "skills/*", strategy: "append", source: "notice.md" }],
      }),
    );
    writeFileSync(join(presetDir, "notice.md"), "NOTICE");
    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["default"] }),
    );

    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "body");
    expect(result!.content).toBe("body\nNOTICE");
  });

  it("lists active presets in registry order", () => {
    const presetDir = join(tmp, ".gxpm", "presets", "alpha");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, "manifest.json"),
      JSON.stringify({ id: "alpha", name: "Alpha", version: "1.0.0", rules: [] }),
    );

    const betaDir = join(tmp, ".gxpm", "presets", "beta");
    mkdirSync(betaDir, { recursive: true });
    writeFileSync(
      join(betaDir, "manifest.json"),
      JSON.stringify({ id: "beta", name: "Beta", version: "1.0.0", rules: [] }),
    );

    writeFileSync(
      join(tmp, ".gxpm", "presets", ".registry"),
      JSON.stringify({ active: ["beta", "alpha"] }),
    );

    resolver.load();
    expect(resolver.listActive()).toEqual(["beta", "alpha"]);
    expect(resolver.listPresets()).toContain("alpha");
    expect(resolver.listPresets()).toContain("beta");
  });
});
