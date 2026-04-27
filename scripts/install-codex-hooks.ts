import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface InstallCodexHooksOptions {
  /** "repo" → <target>/.codex/ (default), "user" → ~/.codex/ (broader, more invasive). */
  scope?: "user" | "repo";
  /** Target repo (only used when scope === "repo"). Defaults to cwd. */
  target?: string;
  /** Override $HOME for testing. */
  home?: string;
  /** Override gxpm repo root for testing. */
  gxpmRoot?: string;
  /** When true (default), enable codex_hooks feature flag in ~/.codex/config.toml if missing. */
  enableFeatureFlag?: boolean;
}

interface InstallResult {
  installedScripts: string[];
  hooksJsonPath: string;
  rootDir: string;
  featureFlagEnabled: "already-set" | "enabled-now" | "skipped" | "config-missing";
}

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

const HOOK_SCRIPTS = ["session-start.sh", "user-prompt-submit.sh", "pre-tool-use.sh"];

export function installCodexHooks(options: InstallCodexHooksOptions = {}): InstallResult {
  const scope = options.scope ?? "repo";
  const home = options.home ?? homedir();
  const gxpmRoot = options.gxpmRoot ?? DEFAULT_GXPM_ROOT;

  const rootDir =
    scope === "user" ? join(home, ".codex") : join(resolve(options.target ?? process.cwd()), ".codex");

  const hooksDir = join(rootDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const templatesDir = join(gxpmRoot, "templates", "codex-hooks");
  const installedScripts: string[] = [];

  for (const script of HOOK_SCRIPTS) {
    const src = join(templatesDir, script);
    const dst = join(hooksDir, `gxpm-${script}`);
    copyFileSync(src, dst);
    execSync(`chmod +x "${dst}"`);
    installedScripts.push(dst);
  }

  // Write/merge hooks.json — use stable path keys so re-running is idempotent.
  const hooksJsonPath = join(rootDir, "hooks.json");
  const sessionStartCmd = join(hooksDir, "gxpm-session-start.sh");
  const promptSubmitCmd = join(hooksDir, "gxpm-user-prompt-submit.sh");

  // Per Codex official spec: "If timeout is omitted, Codex uses 600 seconds."
  // We omit timeout to inherit the official default rather than override it.
  // statusMessage and type are kept because they are official supported fields.
  const preToolUseCmd = join(hooksDir, "gxpm-pre-tool-use.sh");
  const newConfig = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: sessionStartCmd,
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
              command: promptSubmitCmd,
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
              command: preToolUseCmd,
              statusMessage: "gxpm: recording update_plan payload",
            },
          ],
        },
      ],
    },
  };

  const merged = mergeWithExisting(hooksJsonPath, newConfig);
  writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + "\n");

  const featureFlagEnabled = (options.enableFeatureFlag ?? true)
    ? ensureCodexHooksFeatureFlag(home)
    : "skipped";

  return { installedScripts, hooksJsonPath, rootDir, featureFlagEnabled };
}

/**
 * Codex requires `[features] codex_hooks = true` in ~/.codex/config.toml for hooks
 * to fire. Per official spec we ensure it's set; idempotent + creates timestamped
 * backup before any write.
 */
function ensureCodexHooksFeatureFlag(home: string): "already-set" | "enabled-now" | "config-missing" {
  const configPath = join(home, ".codex", "config.toml");
  if (!existsSync(configPath)) return "config-missing";

  const content = readFileSync(configPath, "utf8");
  if (/^codex_hooks\s*=\s*true\s*$/m.test(content)) return "already-set";

  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backup = `${configPath}.bak-codex-hooks-${ts}`;
  writeFileSync(backup, content);

  // Insert into existing [features] section, or create one at end of file.
  const featuresMatch = content.match(/^\[features\]\s*$/m);
  let updated: string;
  if (featuresMatch) {
    const lines = content.split("\n");
    const idx = lines.findIndex((line) => /^\[features\]\s*$/.test(line));
    // Find end of this section (next [section] or EOF)
    let endIdx = lines.length;
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^\[/.test(lines[i])) { endIdx = i; break; }
    }
    // Insert before next section, skipping trailing blank lines
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
      const filteredHooks = (entry.hooks ?? []).filter((h: any) => !ourCommands.has(h.command));
      if (filteredHooks.length > 0) {
        otherEntries.push({ ...entry, hooks: filteredHooks });
      }
    }
    existingHooks[event] = [...otherEntries, ...ourEntries];
  }

  return { ...existing, hooks: existingHooks };
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
    for (const script of result.installedScripts) {
      console.log(`installed: ${script}`);
    }
    console.log(`wrote: ${result.hooksJsonPath}`);
    console.log("");
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
        console.log("feature flag: ⚠️  ~/.codex/config.toml not found; create it with [features]\\ncodex_hooks = true");
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
