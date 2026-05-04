import type { HostConfig } from "../core/contracts/host";

export const claudeHostConfig: HostConfig = {
  name: "claude",
  displayName: "Claude Code",
  cliCommand: "claude",
  hostSubdir: ".claude",
  globalRoot: ".claude/skills/gxpm",
  localSkillRoot: ".claude/skills/gxpm",
  usesEnvVars: false,
  frontmatter: {
    mode: "preserve",
  },
  install: {
    strategy: "copy",
  },
};
