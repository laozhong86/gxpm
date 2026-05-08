import type { HostAdapter, CommandDef } from "../schema";

export const cursorAdapter: HostAdapter = {
  key: "cursor",
  name: "Cursor",
  cliCommand: "cursor",

  detect(): boolean {
    try {
      return Bun.which("cursor") !== null;
    } catch {
      return false;
    }
  },

  install(_command: CommandDef, _projectRoot: string): void {
    throw new Error("Cursor install not yet implemented via registry");
  },

  uninstall(_commandName: string, _projectRoot: string): void {
    throw new Error("Cursor uninstall not yet implemented via registry");
  },

  preferredFormat(): "markdown" {
    return "markdown";
  },
};
