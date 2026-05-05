// PRESET RESOLVER — Override > Preset > Core three-layer resolution.
// Supports replace / prepend / append / wrap composition strategies.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type CompositionStrategy = "replace" | "prepend" | "append" | "wrap";

export interface CompositionRule {
  /** Target file path, relative to project root (e.g. "skills/gxpm/SKILL.md"). */
  target: string;
  /** How to compose the source into the target. */
  strategy: CompositionStrategy;
  /** Source file path, relative to the preset directory. */
  source: string;
  /** Optional anchor marker for prepend/append/wrap positioning. */
  anchor?: string;
}

export interface PresetManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** IDs of presets this one extends (lower priority). */
  extends?: string[];
  /** Composition rules for this preset. */
  rules: CompositionRule[];
}

export interface PresetRegistry {
  /** Ordered list of active preset IDs (highest priority first). */
  active: string[];
}

export interface ResolveResult {
  content: string;
  /** Which layer provided the final content. */
  source: "override" | "preset" | "core";
  /** Preset IDs that contributed (empty for override/core). */
  appliedPresets: string[];
}

const PRESET_REGISTRY_FILE = ".registry";
const MANIFEST_FILE = "manifest.json";

export class PresetResolver {
  private presets = new Map<string, PresetManifest>();
  private registry: PresetRegistry = { active: [] };

  constructor(private projectRoot: string) {}

  /** Load the preset registry and all active preset manifests. */
  load(): void {
    this.presets.clear();
    this.loadRegistry();
    for (const presetId of this.registry.active) {
      this.loadPreset(presetId);
    }
  }

  /**
   * Resolve the final content for a target path.
   *
   * Priority: Override > Preset > Core
   *
   * @param targetPath — file path relative to project root
   * @param baseContent — core-layer content (e.g. template-generated output)
   * @returns resolved content and metadata, or null if no content found
   */
  resolve(targetPath: string, baseContent?: string): ResolveResult | null {
    const normalized = targetPath.replace(/^\//, "");

    // 1. Override layer (highest priority)
    const overridePath = join(this.projectRoot, ".gxpm", "overrides", normalized);
    if (existsSync(overridePath)) {
      return {
        content: readFileSync(overridePath, "utf8"),
        source: "override",
        appliedPresets: [],
      };
    }

    // 2. Preset layer (middle priority)
    let content = baseContent ?? "";
    let presetApplied = false;
    const appliedPresets: string[] = [];

    for (const presetId of this.registry.active) {
      const preset = this.presets.get(presetId);
      if (!preset) continue;

      const rules = preset.rules.filter((r) => this.matchTarget(r.target, normalized));
      if (rules.length === 0) continue;

      for (const rule of rules) {
        const sourcePath = join(this.presetDir, presetId, rule.source);
        if (!existsSync(sourcePath)) continue;
        const sourceContent = readFileSync(sourcePath, "utf8");
        content = this.applyStrategy(content, sourceContent, rule.strategy, rule.anchor);
        presetApplied = true;
      }

      appliedPresets.push(presetId);
    }

    if (presetApplied) {
      return { content, source: "preset", appliedPresets };
    }

    // 3. Core layer (lowest priority)
    if (baseContent !== undefined) {
      return { content: baseContent, source: "core", appliedPresets: [] };
    }

    // No content available at any layer
    return null;
  }

  /** List all loaded preset IDs. */
  listPresets(): string[] {
    return Array.from(this.presets.keys());
  }

  /** List active preset IDs in resolution order. */
  listActive(): string[] {
    return [...this.registry.active];
  }

  /** Get a loaded preset manifest by ID. */
  getPreset(id: string): PresetManifest | undefined {
    return this.presets.get(id);
  }

  private get presetDir(): string {
    return join(this.projectRoot, ".gxpm", "presets");
  }

  private loadRegistry(): void {
    const registryPath = join(this.presetDir, PRESET_REGISTRY_FILE);
    if (!existsSync(registryPath)) {
      this.registry = { active: [] };
      return;
    }
    try {
      const raw = readFileSync(registryPath, "utf8");
      const doc = JSON.parse(raw) as PresetRegistry;
      this.registry = { active: doc.active ?? [] };
    } catch {
      this.registry = { active: [] };
    }
  }

  private loadPreset(id: string): void {
    const manifestPath = join(this.presetDir, id, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      return;
    }
    try {
      const raw = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw) as PresetManifest;
      this.presets.set(id, manifest);
    } catch {
      // Silently skip malformed presets
    }
  }

  private matchTarget(ruleTarget: string, filePath: string): boolean {
    // Simple glob-like matching: exact match or wildcard suffix
    if (ruleTarget === filePath) return true;
    if (ruleTarget.endsWith("/*")) {
      const prefix = ruleTarget.slice(0, -1);
      return filePath.startsWith(prefix);
    }
    if (ruleTarget.includes("*")) {
      const regex = new RegExp("^" + ruleTarget.replace(/\*/g, ".*") + "$");
      return regex.test(filePath);
    }
    return false;
  }

  private applyStrategy(
    base: string,
    source: string,
    strategy: CompositionStrategy,
    anchor?: string,
  ): string {
    switch (strategy) {
      case "replace":
        return source;
      case "prepend":
        return anchor ? this.insertBefore(base, source, anchor) : source + "\n" + base;
      case "append":
        return anchor ? this.insertAfter(base, source, anchor) : base + "\n" + source;
      case "wrap": {
        if (anchor) {
          const parts = base.split(anchor);
          if (parts.length >= 2) {
            return parts[0] + source + parts.slice(1).join(anchor);
          }
        }
        return source + "\n" + base + "\n" + source;
      }
      default:
        return base;
    }
  }

  private insertBefore(base: string, source: string, anchor: string): string {
    const idx = base.indexOf(anchor);
    if (idx === -1) return source + "\n" + base;
    return base.slice(0, idx) + source + "\n" + base.slice(idx);
  }

  private insertAfter(base: string, source: string, anchor: string): string {
    const idx = base.lastIndexOf(anchor);
    if (idx === -1) return base + "\n" + source;
    const end = idx + anchor.length;
    return base.slice(0, end) + "\n" + source + base.slice(end);
  }
}
