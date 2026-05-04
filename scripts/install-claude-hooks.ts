/**
 * Install Claude Code hooks that call the unified `gxpm hook` entry point.
 *
 * Writes/merges a `hooks` block into `.claude/settings.json` (repo scope)
 * or `~/.claude/settings.json` (user scope).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface InstallClaudeHooksOptions {
  /** "repo" → <target>/.claude/ (default), "user" → ~/.claude/ */
  scope?: "user" | "repo";
  target?: string;
  home?: string;
}

interface InstallResult {
  settingsJsonPath: string;
  rootDir: string;
}

export function installClaudeHooks(options: InstallClaudeHooksOptions = {}): InstallResult {
  const scope = options.scope ?? "repo";
  const home = options.home ?? homedir();

  const rootDir =
    scope === "user" ? join(home, ".claude") : join(resolve(options.target ?? process.cwd()), ".claude");
  mkdirSync(rootDir, { recursive: true });

  const settingsJsonPath = join(rootDir, "settings.json");

  const newConfig = {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: "gxpm hook SessionStart --host claude",
              statusMessage: "gxpm: loading capability hint",
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: "gxpm hook UserPromptSubmit --host claude",
              statusMessage: "gxpm: resolving referenced issue",
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "ExitPlanMode",
          hooks: [
            {
              type: "command",
              command: "gxpm hook PreToolUse --host claude",
              statusMessage: "gxpm: recording plan payload",
            },
          ],
        },
      ],
    },
  };

  const merged = mergeWithExisting(settingsJsonPath, newConfig);
  writeFileSync(settingsJsonPath, JSON.stringify(merged, null, 2) + "\n");

  return { settingsJsonPath, rootDir };
}

function mergeWithExisting(path: string, fresh: Record<string, any>) {
  if (!existsSync(path)) return fresh;
  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fresh;
  }

  const eventNames = Object.keys(fresh.hooks ?? {});
  const existingHooks = existing.hooks ?? {};

  for (const event of eventNames) {
    const ourEntries = (fresh.hooks as Record<string, any[]>)[event] ?? [];
    const ourCommands = new Set(
      ourEntries.flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command)),
    );
    const otherEntries: any[] = [];
    for (const entry of existingHooks[event] ?? []) {
      const filteredHooks = (entry.hooks ?? []).filter((h: any) => !ourCommands.has(h.command));
      if (filteredHooks.length > 0) {
        otherEntries.push({ ...entry, hooks: filteredHooks });
      }
    }
    existingHooks[event] = [...otherEntries, ...ourEntries];
  }

  return { ...existing, hooks: existingHooks };
}

function parseArgs(argv: string[]): InstallClaudeHooksOptions {
  const opts: InstallClaudeHooksOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--scope") opts.scope = argv[++i] as "user" | "repo";
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--home") opts.home = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

if (import.meta.main) {
  try {
    const result = installClaudeHooks(parseArgs(Bun.argv.slice(2)));
    console.log(`wrote: ${result.settingsJsonPath}`);
    console.log(
      "scope:",
      result.rootDir.includes(homedir() + "/.claude") ? "user (~/.claude/)" : "repo (<repo>/.claude/)",
    );
    console.log("Restart Claude Code to activate hooks.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
