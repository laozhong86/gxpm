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
