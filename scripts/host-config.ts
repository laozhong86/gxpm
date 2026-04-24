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

const HOST_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const CLI_PATTERN = /^[a-z][a-z0-9-]*$/;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/).+$/;

export function validateHostConfig(config: HostConfig): string[] {
  const errors: string[] = [];

  if (!HOST_NAME_PATTERN.test(config.name)) {
    errors.push(`${config.name || "<missing>"}: host name must be lowercase kebab-case`);
  }

  if (!config.displayName.trim()) {
    errors.push(`${config.name}: displayName is required`);
  }

  if (!CLI_PATTERN.test(config.cliCommand)) {
    errors.push(`${config.name}: cliCommand must be a simple executable name`);
  }

  for (const [field, value] of [
    ["hostSubdir", config.hostSubdir],
    ["globalRoot", config.globalRoot],
    ["localSkillRoot", config.localSkillRoot],
  ] as const) {
    if (!SAFE_RELATIVE_PATH.test(value)) {
      errors.push(`${config.name}: ${field} must be a safe relative path`);
    }
  }

  if (config.frontmatter.mode === "allowlist" && config.frontmatter.keys.length === 0) {
    errors.push(`${config.name}: frontmatter allowlist needs at least one key`);
  }

  if (!["copy", "symlink"].includes(config.install.strategy)) {
    errors.push(`${config.name}: unsupported install strategy ${config.install.strategy}`);
  }

  return errors;
}

export function validateAllConfigs(configs: readonly HostConfig[]): string[] {
  const errors = configs.flatMap(validateHostConfig);

  for (const field of ["name", "hostSubdir", "globalRoot"] as const) {
    const seen = new Map<string, string>();
    for (const config of configs) {
      const value = config[field];
      const owner = seen.get(value);
      if (owner) {
        errors.push(`${config.name}: ${field} duplicates ${owner} (${value})`);
      } else {
        seen.set(value, config.name);
      }
    }
  }

  return errors;
}
