// PRESET CLI — gxpm preset add/remove/list/show/init

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PresetResolver } from "../../core/preset-system/preset-resolver";

const PRESET_DIR = ".gxpm/presets";
const REGISTRY_FILE = ".registry";

function getPresetDir(root: string): string {
  return join(root, PRESET_DIR);
}

function readRegistry(root: string): { active: string[] } {
  const path = join(getPresetDir(root), REGISTRY_FILE);
  if (!existsSync(path)) return { active: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { active: string[] };
  } catch {
    return { active: [] };
  }
}

function writeRegistry(root: string, registry: { active: string[] }): void {
  const dir = getPresetDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, REGISTRY_FILE), JSON.stringify(registry, null, 2) + "\n");
}

function readManifest(root: string, id: string) {
  const path = join(getPresetDir(root), id, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      id: string;
      name: string;
      version: string;
      description?: string;
      rules: unknown[];
    };
  } catch {
    return null;
  }
}

export function runPresetCommand(
  _argv: string[],
  subcommand: string | undefined,
  id: string | undefined,
): void {
  const root = process.cwd();

  switch (subcommand) {
    case "list": {
      const resolver = new PresetResolver(root);
      resolver.load();
      const active = resolver.listActive();
      const all = resolver.listPresets();

      if (all.length === 0) {
        console.log("No presets found.");
        return;
      }

      console.log("Presets:");
      for (const presetId of all) {
        const manifest = resolver.getPreset(presetId);
        const isActive = active.includes(presetId);
        const marker = isActive ? "*" : " ";
        console.log(`  [${marker}] ${presetId}: ${manifest?.name ?? "(unknown)"} (${manifest?.version ?? "?"})`);
      }
      if (active.length > 0) {
        console.log(`\nActive order: ${active.join(" > ")}`);
      }
      return;
    }

    case "add": {
      if (!id) {
        throw new Error("Usage: gxpm preset add <preset-id>");
      }
      const manifest = readManifest(root, id);
      if (!manifest) {
        throw new Error(`Preset '${id}' not found. Run 'gxpm preset init ${id}' to create it.`);
      }
      const registry = readRegistry(root);
      if (registry.active.includes(id)) {
        console.log(`Preset '${id}' is already active.`);
        return;
      }
      registry.active.push(id);
      writeRegistry(root, registry);
      console.log(`Added preset '${id}' to active list.`);
      return;
    }

    case "remove": {
      if (!id) {
        throw new Error("Usage: gxpm preset remove <preset-id>");
      }
      const registry = readRegistry(root);
      if (!registry.active.includes(id)) {
        console.log(`Preset '${id}' is not active.`);
        return;
      }
      registry.active = registry.active.filter((x) => x !== id);
      writeRegistry(root, registry);
      console.log(`Removed preset '${id}' from active list.`);
      return;
    }

    case "show": {
      if (!id) {
        throw new Error("Usage: gxpm preset show <preset-id>");
      }
      const manifest = readManifest(root, id);
      if (!manifest) {
        throw new Error(`Preset '${id}' not found.`);
      }
      console.log(`ID: ${manifest.id}`);
      console.log(`Name: ${manifest.name}`);
      console.log(`Version: ${manifest.version}`);
      if (manifest.description) console.log(`Description: ${manifest.description}`);
      console.log(`Rules: ${manifest.rules.length}`);
      for (const rule of manifest.rules) {
        const r = rule as { target: string; strategy: string; source: string };
        console.log(`  - ${r.target} [${r.strategy}] <- ${r.source}`);
      }
      return;
    }

    case "init": {
      if (!id) {
        throw new Error("Usage: gxpm preset init <preset-id>");
      }
      const presetPath = join(getPresetDir(root), id);
      if (existsSync(presetPath)) {
        throw new Error(`Preset '${id}' already exists at ${presetPath}`);
      }
      mkdirSync(presetPath, { recursive: true });
      const manifest = {
        id,
        name: id,
        version: "1.0.0",
        description: `Preset '${id}'`,
        rules: [],
      };
      writeFileSync(join(presetPath, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      console.log(`Initialized preset '${id}' at ${presetPath}`);
      console.log(`Edit ${join(presetPath, "manifest.json")} and add source files.`);
      return;
    }

    default:
      throw new Error(
        `Unknown preset command: ${subcommand ?? ""}\nUsage: gxpm preset <list|add|remove|show|init> [id]`,
      );
  }
}
