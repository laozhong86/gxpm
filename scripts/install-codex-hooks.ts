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
}

interface InstallResult {
  installedScripts: string[];
  hooksJsonPath: string;
  rootDir: string;
}

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

const HOOK_SCRIPTS = ["session-start.sh", "user-prompt-submit.sh"];

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

  const newConfig = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: sessionStartCmd,
              timeout: 10,
              statusMessage: "gxpm: scanning active issues",
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
              timeout: 10,
              statusMessage: "gxpm: resolving referenced issue",
            },
          ],
        },
      ],
    },
  };

  const merged = mergeWithExisting(hooksJsonPath, newConfig);
  writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + "\n");

  return { installedScripts, hooksJsonPath, rootDir };
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
    console.log("Hooks scope:", result.rootDir.includes(homedir() + "/.codex") ? "user (~/.codex/)" : "repo (<repo>/.codex/)");
    console.log("");
    console.log("⚠️  IMPORTANT: enable the codex_hooks feature flag in ~/.codex/config.toml:");
    console.log("");
    console.log("  [features]");
    console.log("  codex_hooks = true");
    console.log("");
    console.log("For repo-scope hooks: also trust the .codex/ layer when Codex prompts.");
    console.log("Then restart Codex to activate hooks.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
