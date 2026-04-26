import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface UninstallOptions {
  target?: string;
  home?: string;
  dryRun?: boolean;
  purge?: boolean;
}

interface PlannedAction {
  kind: "remove" | "update";
  path: string;
}

const GIT_HOOKS = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "post-merge",
  "gxpm-pre-commit",
  "gxpm-commit-msg",
  "gxpm-pre-push",
  "gxpm-post-merge",
];

const CODEX_HOOK_SCRIPTS = [
  "gxpm-session-start.sh",
  "gxpm-user-prompt-submit.sh",
];

export function planUninstall(options: UninstallOptions = {}): PlannedAction[] {
  const home = options.home ?? homedir();
  const target = resolve(options.target ?? process.cwd());
  const actions: PlannedAction[] = [
    { kind: "remove", path: join(home, ".codex", "skills", "gxpm") },
    { kind: "remove", path: join(home, ".claude", "skills", "gxpm") },
    ...GIT_HOOKS.map((hook) => ({ kind: "remove" as const, path: join(target, ".githooks", hook) })),
    ...CODEX_HOOK_SCRIPTS.map((script) => ({
      kind: "remove" as const,
      path: join(target, ".codex", "hooks", script),
    })),
  ];

  const hooksJson = join(target, ".codex", "hooks.json");
  if (existsSync(hooksJson)) {
    actions.push({ kind: "update", path: hooksJson });
  }

  if (options.purge) {
    actions.push({ kind: "remove", path: join(home, ".gxpm") });
  }

  return actions;
}

export function runUninstall(options: UninstallOptions = {}): PlannedAction[] {
  const actions = planUninstall(options);
  if (options.dryRun) {
    return actions;
  }

  for (const action of actions) {
    if (action.kind === "remove") {
      removePath(action.path);
    } else {
      removeCodexHookEntries(action.path);
    }
  }

  return actions;
}

function removePath(path: string) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

function removeCodexHookEntries(path: string) {
  if (!existsSync(path)) return;
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object" || !parsed.hooks || typeof parsed.hooks !== "object") {
    return;
  }

  for (const eventName of Object.keys(parsed.hooks)) {
    const entries = Array.isArray(parsed.hooks[eventName]) ? parsed.hooks[eventName] : [];
    const nextEntries = entries
      .map((entry: any) => {
        const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
        const kept = hooks.filter((hook: any) => {
          const command = typeof hook?.command === "string" ? hook.command : "";
          return !CODEX_HOOK_SCRIPTS.some((script) => command.includes(script));
        });
        return { ...entry, hooks: kept };
      })
      .filter((entry: any) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

    if (nextEntries.length > 0) {
      parsed.hooks[eventName] = nextEntries;
    } else {
      delete parsed.hooks[eventName];
    }
  }

  writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n");
}

function describeAction(action: PlannedAction, dryRun: boolean) {
  const prefix = dryRun ? "would" : "did";
  if (action.kind === "remove") {
    const type = existsSync(action.path) && lstatSync(action.path).isDirectory() ? "directory" : "path";
    return `${prefix} remove ${type}: ${action.path}`;
  }
  return `${prefix} update file: ${action.path}`;
}

function parseArgs(argv: string[]): UninstallOptions {
  const options: UninstallOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--purge") {
      options.purge = true;
    } else if (arg === "--target") {
      options.target = argv[++index];
    } else if (arg === "--home") {
      options.home = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    const actions = runUninstall(options);
    for (const action of actions) {
      console.log(describeAction(action, options.dryRun ?? false));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
