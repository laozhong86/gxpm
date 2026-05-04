import type { HostConfig } from "../core/contracts/host";

export const cursorHostConfig: HostConfig = {
  name: "cursor",
  displayName: "Cursor",
  cliCommand: "cursor",
  hostSubdir: ".cursor",
  globalRoot: ".cursor/skills/gxpm",
  localSkillRoot: ".cursor/skills/gxpm",
  usesEnvVars: false,
  frontmatter: {
    mode: "preserve",
  },
  install: {
    strategy: "copy",
  },
};
