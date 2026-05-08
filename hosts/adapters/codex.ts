import type { HostAdapter, CommandDef } from "../schema";

export const codexAdapter: HostAdapter = {
  key: "codex",
  name: "OpenAI Codex CLI",
  cliCommand: "codex",

  detect(): boolean {
    try {
      return Bun.which("codex") !== null;
    } catch {
      return false;
    }
  },

  install(_command: CommandDef, _projectRoot: string): void {
    throw new Error("Codex CLI install not yet implemented via registry");
  },

  uninstall(_commandName: string, _projectRoot: string): void {
    throw new Error("Codex CLI uninstall not yet implemented via registry");
  },

  preferredFormat(): "skills" {
    return "skills";
  },
};
