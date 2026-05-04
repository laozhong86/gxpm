// CONTRACT LAYER — zero external dependencies.
// Host adapters and skill tooling import types from this subpath.
// HARD RULE: This file must never import SDK packages or other runtime modules.

export type FrontmatterConfig =
  | {
      mode: "preserve";
      keys?: never;
    }
  | {
      mode: "allowlist";
      keys: string[];
    };

export interface HostHooksConfig {
  /** Name of the configuration file that holds hooks (e.g. "settings.json", "hooks.json") */
  configFileName: string;
  /** Serialization format of the config file */
  configFormat: "json" | "toml";
  /** Path segments relative to the host root (e.g. [".claude", "settings.json"]) */
  configPathSegments: string[];
  /** Whether a feature flag must be enabled for hooks to fire */
  featureFlagRequired?: boolean;
  /** Key name of the feature flag inside the config file */
  featureFlagKey?: string;
  /** TOML section that contains the feature flag (e.g. "[features]") */
  featureFlagSection?: string;
}

export interface HostConfig {
  name: string;
  displayName: string;
  cliCommand: string;
  hostSubdir: string;
  globalRoot: string;
  localSkillRoot: string;
  usesEnvVars: boolean;
  frontmatter: FrontmatterConfig;
  install: {
    strategy: "copy" | "symlink";
  };
  hooks?: HostHooksConfig;
}
