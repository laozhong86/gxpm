import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TemplateResolver } from "./template-resolver";

describe("TemplateResolver", () => {
  let root: string;
  let resolver: TemplateResolver;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gxpm-template-test-"));
    mkdirSync(join(root, ".gxpm", "overrides"), { recursive: true });
    mkdirSync(join(root, ".gxpm", "presets"), { recursive: true });
    mkdirSync(join(root, ".gxpm", "extensions"), { recursive: true });
    mkdirSync(join(root, "skills", "gxpm"), { recursive: true });
    resolver = new TemplateResolver(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves core layer when nothing else exists", () => {
    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core-content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("core-content");
    expect(result!.source).toBe("core");
  });

  it("override layer takes highest priority", () => {
    const overrideFile = join(root, ".gxpm", "overrides", "skills", "gxpm", "SKILL.md");
    mkdirSync(join(root, ".gxpm", "overrides", "skills", "gxpm"), { recursive: true });
    writeFileSync(overrideFile, "override-content");
    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core-content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("override-content");
    expect(result!.source).toBe("override");
  });

  it("extension layer is applied above core", () => {
    const extDir = join(root, ".gxpm", "extensions", "my-ext");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ id: "my-ext", name: "My Ext", version: "1.0.0" }));
    mkdirSync(join(extDir, "skills", "gxpm"), { recursive: true });
    writeFileSync(join(extDir, "skills", "gxpm", "SKILL.md"), "ext-content");
    resolver.load();
    const result = resolver.resolve("skills/gxpm/SKILL.md", "core-content");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("ext-content");
    expect(result!.source).toBe("extension");
    expect(result!.appliedExtensions).toContain("my-ext");
  });

  it("returns null when no content available", () => {
    resolver.load();
    const result = resolver.resolve("nonexistent/file.txt");
    expect(result).toBeNull();
  });

  it("lists loaded extensions", () => {
    const extDir = join(root, ".gxpm", "extensions", "ext-a");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ id: "ext-a", name: "Ext A", version: "1.0.0" }));
    resolver.load();
    expect(resolver.listExtensions()).toContain("ext-a");
  });
});
