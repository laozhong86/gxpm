/**
 * Template Resolver — 4-layer priority stack.
 *
 * Priority: Override > Preset > Extension > Core
 *
 * Built on top of PresetResolver (which already handles Override > Preset > Core).
 * This module adds the Extension layer and provides a unified resolve() API.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PresetResolver, type ResolveResult as PresetResolveResult } from "./preset-system/preset-resolver";

export type ResolutionLayer = "override" | "preset" | "extension" | "core";

export interface TemplateResolveResult {
  content: string;
  /** Which layer provided the final content. */
  source: ResolutionLayer;
  /** Preset IDs that contributed (empty for override/extension/core). */
  appliedPresets: string[];
  /** Extension IDs that contributed (empty for override/preset/core). */
  appliedExtensions: string[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
}

const EXTENSION_MANIFEST_FILE = "manifest.json";

export class TemplateResolver {
  private presetResolver: PresetResolver;
  private extensions = new Map<string, ExtensionManifest>();
  private extensionDir: string;

  constructor(private projectRoot: string) {
    this.presetResolver = new PresetResolver(projectRoot);
    this.extensionDir = join(projectRoot, ".gxpm", "extensions");
  }

  /** Load presets and extensions. */
  load(): void {
    this.presetResolver.load();
    this.loadExtensions();
  }

  /**
   * Resolve template content for a target path.
   *
   * Priority stack:
   * 1. Override (`.gxpm/overrides/`) — highest
   * 2. Preset (`.gxpm/presets/<id>/`)
   * 3. Extension (`.gxpm/extensions/<id>/`)
   * 4. Core (`skills/`, `templates/`) — lowest
   */
  resolve(targetPath: string, baseContent?: string): TemplateResolveResult | null {
    const normalized = targetPath.replace(/^\//, "");

    // 1. Override layer
    const overridePath = join(this.projectRoot, ".gxpm", "overrides", normalized);
    if (existsSync(overridePath)) {
      return {
        content: readFileSync(overridePath, "utf8"),
        source: "override",
        appliedPresets: [],
        appliedExtensions: [],
      };
    }

    // 2. Preset layer (reuse PresetResolver for Override > Preset > Core logic,
    //    but we only want Preset + Core here; we handle Override above and
    //    Extension below manually.)
    const presetResult = this.presetResolver.resolve(normalized, baseContent);

    // 3. Extension layer — applied AFTER preset but BEFORE core.
    //    If preset already resolved, extension can further compose on top.
    let content = presetResult?.content ?? baseContent ?? "";
    let source: ResolutionLayer = presetResult?.source ?? "core";
    const appliedExtensions: string[] = [];

    for (const [extId, manifest] of this.extensions) {
      const extFilePath = join(this.extensionDir, extId, normalized);
      if (!existsSync(extFilePath)) continue;
      const extContent = readFileSync(extFilePath, "utf8");
      // Extension defaults to "replace" behavior for MVP.
      // Future: support composition strategies via manifest.
      content = extContent;
      source = "extension";
      appliedExtensions.push(manifest.id);
    }

    if (appliedExtensions.length > 0) {
      return {
        content,
        source,
        appliedPresets: presetResult?.appliedPresets ?? [],
        appliedExtensions,
      };
    }

    // If no extension applied, return whatever preset/core gave us.
    if (presetResult) {
      return {
        content: presetResult.content,
        source: presetResult.source as ResolutionLayer,
        appliedPresets: presetResult.appliedPresets,
        appliedExtensions: [],
      };
    }

    // 4. Core layer — if baseContent was provided but no higher layer matched
    if (baseContent !== undefined) {
      return {
        content: baseContent,
        source: "core",
        appliedPresets: [],
        appliedExtensions: [],
      };
    }

    return null;
  }

  /** List loaded extension IDs. */
  listExtensions(): string[] {
    return Array.from(this.extensions.keys());
  }

  /** Get a loaded extension manifest by ID. */
  getExtension(id: string): ExtensionManifest | undefined {
    return this.extensions.get(id);
  }

  private loadExtensions(): void {
    this.extensions.clear();
    if (!existsSync(this.extensionDir)) return;

    const entries = readdirSync(this.extensionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(this.extensionDir, entry.name, EXTENSION_MANIFEST_FILE);
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = readFileSync(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as ExtensionManifest;
        this.extensions.set(manifest.id, manifest);
      } catch {
        // Silently skip malformed extensions
      }
    }
  }
}
