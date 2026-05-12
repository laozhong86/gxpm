/**
 * Install Codex CLI hooks that call the unified `gxpm hook` entry point.
 *
 * Instead of installing per-event bash scripts, we write a single hooks.json
 * that delegates to `gxpm hook <event> --host codex`. All business logic lives
 * in core/hook-engine.ts and is shared across Claude, Codex, Kimi, and Cursor.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface InstallCodexHooksOptions {
  /** "repo" → <target>/.codex/ (default), "user" → ~/.codex/ */
  scope?: "user" | "repo";
  target?: string;
  home?: string;
  enableFeatureFlag?: boolean;
}

interface InstallResult {
  hooksJsonPath: string;
  rootDir: string;
  featureFlagEnabled: "already-set" | "enabled-now" | "config-missing" | "skipped";
}

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");
const GXPM_CODEX_HOOK_CONFIG = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "gxpm hook SessionStart --host codex",
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
            command: "gxpm hook UserPromptSubmit --host codex",
            statusMessage: "gxpm: resolving referenced issue",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: "gxpm hook PreToolUse --host codex",
            statusMessage: "gxpm: recording update_plan payload",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "gxpm hook Stop --host codex",
            statusMessage: "gxpm: checking autopilot grant",
          },
        ],
      },
    ],
  },
};
const LEGACY_GXPM_CODEX_HOOK_MARKERS: Record<string, string[]> = {
  SessionStart: [
    ".codex/hooks/gxpm-session-start.sh",
    "gxpm-session-start.sh",
  ],
  UserPromptSubmit: [
    ".codex/hooks/gxpm-user-prompt-submit.sh",
    "gxpm-user-prompt-submit.sh",
  ],
  PreToolUse: [
    ".codex/hooks/gxpm-pre-tool-use.sh",
    "gxpm-pre-tool-use.sh",
  ],
  Stop: [
    ".codex/hooks/gxpm-stop.sh",
    "gxpm-stop.sh",
  ],
};

export function installCodexHooks(options: InstallCodexHooksOptions = {}): InstallResult {
  const scope = options.scope ?? "repo";
  const home = options.home ?? homedir();

  const rootDir =
    scope === "user" ? join(home, ".codex") : join(resolve(options.target ?? process.cwd()), ".codex");
  mkdirSync(rootDir, { recursive: true });

  const hooksJsonPath = join(rootDir, "hooks.json");

  const merged = mergeWithExisting(hooksJsonPath, GXPM_CODEX_HOOK_CONFIG);
  writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + "\n");
  const userHooksJsonPath = join(home, ".codex", "hooks.json");
  if (scope === "repo" && resolve(hooksJsonPath) !== resolve(userHooksJsonPath)) {
    removeGxpmOwnedHooksFrom(userHooksJsonPath, GXPM_CODEX_HOOK_CONFIG);
  }

  const featureFlagEnabled = (options.enableFeatureFlag ?? true)
    ? ensureCodexHooksFeatureFlag(home)
    : "skipped";

  return { hooksJsonPath, rootDir, featureFlagEnabled };
}

function ensureCodexHooksFeatureFlag(home: string): "already-set" | "enabled-now" | "config-missing" {
  const configPath = join(home, ".codex", "config.toml");
  if (!existsSync(configPath)) return "config-missing";

  const content = readFileSync(configPath, "utf8");
  if (/^codex_hooks\s*=\s*true\s*$/m.test(content)) return "already-set";

  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backup = `${configPath}.bak-codex-hooks-${ts}`;
  writeFileSync(backup, content);

  const featuresMatch = content.match(/^\[features\]\s*$/m);
  let updated: string;
  if (featuresMatch) {
    const lines = content.split("\n");
    const idx = lines.findIndex((line) => /^\[features\]\s*$/.test(line));
    let endIdx = lines.length;
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^\[/.test(lines[i])) { endIdx = i; break; }
    }
    let insertAt = endIdx;
    while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
    lines.splice(insertAt, 0, "codex_hooks = true");
    updated = lines.join("\n");
  } else {
    updated = content.replace(/\n*$/, "\n\n[features]\ncodex_hooks = true\n");
  }
  writeFileSync(configPath, updated);
  return "enabled-now";
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
      const filteredHooks = (entry.hooks ?? []).filter(
        (h: any) => !isGxpmOwnedCodexHook(event, h.command, ourCommands),
      );
      if (filteredHooks.length > 0) {
        otherEntries.push({ ...entry, hooks: filteredHooks });
      }
    }
    existingHooks[event] = [...otherEntries, ...ourEntries];
  }

  return { ...existing, hooks: existingHooks };
}

function removeGxpmOwnedHooksFrom(path: string, fresh: Record<string, any>) {
  if (!existsSync(path)) return;
  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (!existing.hooks || typeof existing.hooks !== "object") return;

  const eventNames = Object.keys(fresh.hooks ?? {});
  for (const event of eventNames) {
    const entries = Array.isArray(existing.hooks[event]) ? existing.hooks[event] : [];
    const freshEntries = (fresh.hooks as Record<string, any[]>)[event] ?? [];
    const freshCommands = new Set(
      freshEntries.flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command)),
    );
    const nextEntries = entries
      .map((entry: any) => {
        const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
        const keptHooks = hooks.filter(
          (hook: any) => !isGxpmOwnedCodexHook(event, hook.command, freshCommands),
        );
        return { ...entry, hooks: keptHooks };
      })
      .filter((entry: any) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

    if (nextEntries.length > 0) {
      existing.hooks[event] = nextEntries;
    } else {
      delete existing.hooks[event];
    }
  }

  writeFileSync(path, JSON.stringify(existing, null, 2) + "\n");
}

function isGxpmOwnedCodexHook(event: string, command: unknown, currentCommands: Set<unknown>) {
  if (currentCommands.has(command)) return true;
  if (typeof command !== "string") return false;
  return (LEGACY_GXPM_CODEX_HOOK_MARKERS[event] ?? []).some((marker) =>
    command.includes(marker),
  );
}

function parseArgs(argv: string[]): InstallCodexHooksOptions {
  const opts: InstallCodexHooksOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--scope") opts.scope = argv[++i] as "user" | "repo";
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--home") opts.home = argv[++i];
    else if (a === "--no-feature-flag") opts.enableFeatureFlag = false;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

if (import.meta.main) {
  try {
    const result = installCodexHooks(parseArgs(Bun.argv.slice(2)));
    console.log(`wrote: ${result.hooksJsonPath}`);
    console.log(
      "scope:",
      result.rootDir.includes(homedir() + "/.codex") ? "user (~/.codex/)" : "repo (<repo>/.codex/)",
    );

    switch (result.featureFlagEnabled) {
      case "already-set":
        console.log("feature flag: codex_hooks = true (already enabled)");
        break;
      case "enabled-now":
        console.log("feature flag: codex_hooks = true (enabled now; backup written)");
        break;
      case "config-missing":
        console.log("feature flag: ⚠️  ~/.codex/config.toml not found; create it with [features]\ncodex_hooks = true");
        break;
      case "skipped":
        console.log("feature flag: skipped per --no-feature-flag");
        break;
    }
    console.log("");
    console.log("For repo-scope hooks: trust the .codex/ layer when Codex prompts.");
    console.log("Restart Codex to activate hooks.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
