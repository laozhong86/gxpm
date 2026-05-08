/**
 * Host Schema — declarative host adapter protocol.
 *
 * Defines the contract that every host CLI must satisfy to integrate with gxpm.
 */

export type CommandFormat = "markdown" | "toml" | "yaml" | "skills";

export interface CommandDef {
  name: string;
  description: string;
  format: CommandFormat;
  /** Whether this command requires an interactive session */
  interactive?: boolean;
}

export interface HostAdapter {
  /** Unique host identifier (e.g. 'claude', 'codex', 'cursor') */
  key: string;
  /** Human-readable display name */
  name: string;
  /** CLI executable name used for detection */
  cliCommand: string;
  /** Detect whether this host is installed/available */
  detect(): boolean;
  /** Install a gxpm command into the host's command system */
  install(command: CommandDef, projectRoot: string): void;
  /** Uninstall a command from the host */
  uninstall(commandName: string, projectRoot: string): void;
  /** Return the host's preferred command format */
  preferredFormat(): CommandFormat;
}

/** Raw host config used for static declarations (before adapter instantiation) */
export interface HostConfig {
  name: string;
  displayName: string;
  cliCommand: string;
  hostSubdir: string;
  globalRoot: string;
  localSkillRoot: string;
  usesEnvVars: boolean;
  frontmatter: {
    mode: "preserve" | "allowlist";
    keys?: string[];
  };
  install: {
    strategy: "copy" | "symlink";
  };
  hooks?: {
    configFileName: string;
    configFormat: "json" | "toml";
    configPathSegments: string[];
    featureFlagRequired?: boolean;
    featureFlagKey?: string;
    featureFlagSection?: string;
  };
}
