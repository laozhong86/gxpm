import type { HostConfig } from "../core/contracts/host";

export const codexHostConfig: HostConfig = {
  name: "codex",
  displayName: "OpenAI Codex CLI",
  cliCommand: "codex",
  hostSubdir: ".agents",
  globalRoot: ".codex/skills/gxpm",
  localSkillRoot: ".agents/skills/gxpm",
  usesEnvVars: true,
  frontmatter: {
    mode: "allowlist",
    keys: ["name", "description"],
  },
  install: {
    strategy: "copy",
  },
  hooks: {
    configFileName: "hooks.json",
    configFormat: "json",
    configPathSegments: [".codex", "hooks.json"],
    featureFlagRequired: true,
    featureFlagKey: "codex_hooks",
    featureFlagSection: "[features]",
  },
};
