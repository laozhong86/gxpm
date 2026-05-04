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
}
