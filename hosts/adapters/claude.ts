import type { HostAdapter, CommandDef } from "../schema";

export const claudeAdapter: HostAdapter = {
  key: "claude",
  name: "Claude Code",
  cliCommand: "claude",

  detect(): boolean {
    try {
      return Bun.which("claude") !== null;
    } catch {
      return false;
    }
  },

  install(_command: CommandDef, _projectRoot: string): void {
    // TODO: integrate with scripts/install-skill.ts for host-specific install
    throw new Error("Claude Code install not yet implemented via registry");
  },

  uninstall(_commandName: string, _projectRoot: string): void {
    // TODO: integrate with host-specific uninstall
    throw new Error("Claude Code uninstall not yet implemented via registry");
  },

  preferredFormat(): "markdown" {
    return "markdown";
  },
};
