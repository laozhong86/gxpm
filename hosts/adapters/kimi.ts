import type { HostAdapter, CommandDef } from "../schema";

export const kimiAdapter: HostAdapter = {
  key: "kimi",
  name: "Kimi Code CLI",
  cliCommand: "kimi",

  detect(): boolean {
    try {
      return Bun.which("kimi") !== null;
    } catch {
      return false;
    }
  },

  install(_command: CommandDef, _projectRoot: string): void {
    throw new Error("Kimi CLI install not yet implemented via registry");
  },

  uninstall(_commandName: string, _projectRoot: string): void {
    throw new Error("Kimi CLI uninstall not yet implemented via registry");
  },

  preferredFormat(): "skills" {
    return "skills";
  },
};
