import { HOST_REGISTRY, registerHost } from "./registry";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { cursorAdapter } from "./adapters/cursor";
import { kimiAdapter } from "./adapters/kimi";

// Register built-in host adapters (idempotent for test isolation)
if (!HOST_REGISTRY.has(claudeAdapter.key)) registerHost(claudeAdapter);
if (!HOST_REGISTRY.has(codexAdapter.key)) registerHost(codexAdapter);
if (!HOST_REGISTRY.has(cursorAdapter.key)) registerHost(cursorAdapter);
if (!HOST_REGISTRY.has(kimiAdapter.key)) registerHost(kimiAdapter);

// Backward-compatible HostConfig exports
import { claudeHostConfig } from "./claude";
import { codexHostConfig } from "./codex";
import { cursorHostConfig } from "./cursor";

export const ALL_HOST_CONFIGS = [claudeHostConfig, codexHostConfig, cursorHostConfig] as const;
export const ALL_HOST_NAMES = ALL_HOST_CONFIGS.map((host) => host.name);

export type HostName = (typeof ALL_HOST_NAMES)[number];

export function getHostConfig(name: string) {
  const config = ALL_HOST_CONFIGS.find((host) => host.name === name);
  if (!config) {
    throw new Error(`Unknown gxpm host: ${name}`);
  }
  return config;
}

// Re-export new registry system
export { HOST_REGISTRY, registerHost };
export type { HostAdapter, HostConfig, CommandDef } from "./schema";
