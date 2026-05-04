import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installCodexHooks } from "../install-codex-hooks";
import { installSkill } from "../install-skill";

interface InitOptions {
  target?: string;
  nonInteractive?: boolean;
  skipHooks?: boolean;
  skipSkills?: boolean;
  skipCodexHooks?: boolean;
}

const GXPM_HOOK_FILES = [
  "gxpm-pre-commit",
  "gxpm-commit-msg",
  "gxpm-pre-push",
  "gxpm-post-merge",
  "gxpm-post-checkout",
];

const HOOK_SPECS: { gxpmFile: string; topLevelFile: string; argsForwarding: string }[] = [
  { gxpmFile: "gxpm-pre-commit", topLevelFile: "pre-commit", argsForwarding: "" },
  { gxpmFile: "gxpm-commit-msg", topLevelFile: "commit-msg", argsForwarding: ' "$1"' },
  { gxpmFile: "gxpm-pre-push", topLevelFile: "pre-push", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-merge", topLevelFile: "post-merge", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-checkout", topLevelFile: "post-checkout", argsForwarding: ' "$@"' },
];

function dispatcherScript(gxpmFile: string, argsForwarding: string): string {
  return `#!/bin/bash
# gxpm dispatcher (installed by gxpm init)
set -e
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$HOOK_DIR/${gxpmFile}" ]; then
  "$HOOK_DIR/${gxpmFile}"${argsForwarding}
fi
`;
}

function installGitHooks(target: string, gxpmRoot: string): string[] {
  const templatesDir = join(gxpmRoot, "templates", "hooks");
  const hooksDir = join(target, ".githooks");
  mkdirSync(hooksDir, { recursive: true });

  const installed: string[] = [];
  for (const spec of HOOK_SPECS) {
    const src = join(templatesDir, spec.gxpmFile);
    const dst = join(hooksDir, spec.gxpmFile);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      execSync(`chmod +x "${dst}"`);
      installed.push(dst);
    }

    const topLevelPath = join(hooksDir, spec.topLevelFile);
    if (!existsSync(topLevelPath)) {
      writeFileSync(topLevelPath, dispatcherScript(spec.gxpmFile, spec.argsForwarding));
      execSync(`chmod +x "${topLevelPath}"`);
      installed.push(topLevelPath);
    }
  }

  const absoluteHooksPath = join(resolve(target), ".githooks");
  let currentHooksPath = "";
  try {
    currentHooksPath = execSync("git config core.hooksPath", { cwd: target }).toString().trim();
  } catch {
    // unset
  }
  if (currentHooksPath !== absoluteHooksPath) {
    execSync(`git config core.hooksPath "${absoluteHooksPath}"`, { cwd: target });
  }
  return installed;
}

function ensureGxpmDir(target: string): string[] {
  const dirs = [
    join(target, ".gxpm", "issues"),
    join(target, ".gxpm", "local"),
    join(target, ".gxpm", "out-of-scope"),
    join(target, ".gxpm", "wiki"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

function ensureDefaultConfig(target: string): string | null {
  const configPath = join(target, ".gxpm", "config.json");
  if (existsSync(configPath)) return null;

  const defaultConfig = {
    worktree: { enforcement: "optional", default: "ask" },
    sync: { provider: "none", autoSync: false, syncArtifacts: true },
    update_check: true,
  };
  writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n");
  return configPath;
}

function isGitRepo(dir: string): boolean {
  const gitDir = join(dir, ".git");
  if (!existsSync(gitDir)) return false;
  try {
    return statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

export function runInitCommand(argv: string[]) {
  const options: InitOptions = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--target") {
      options.target = argv[++i];
    } else if (arg === "--non-interactive") {
      options.nonInteractive = true;
    } else if (arg === "--skip-hooks") {
      options.skipHooks = true;
    } else if (arg === "--skip-skills") {
      options.skipSkills = true;
    } else if (arg === "--skip-codex-hooks") {
      options.skipCodexHooks = true;
    }
    i++;
  }

  const target = resolve(options.target ?? process.cwd());
  const gxpmRoot = resolve(import.meta.dir, "../..");

  if (!isGitRepo(target)) {
    throw new Error(`Not a git repository: ${target}. gxpm requires git.`);
  }

  const results: Record<string, string[]> = {
    dirs: [],
    hooks: [],
    codexHooks: [],
    skills: [],
    config: [],
  };

  // 1. Ensure .gxpm/ directory structure
  results.dirs = ensureGxpmDir(target);

  // 2. Git hooks
  if (!options.skipHooks) {
    results.hooks = installGitHooks(target, gxpmRoot);
  }

  // 3. Codex hooks (if .codex/ exists or --non-interactive and user has ~/.codex)
  if (!options.skipCodexHooks) {
    const hasRepoCodex = existsSync(join(target, ".codex"));
    const hasUserCodex = existsSync(join(homedir(), ".codex"));
    if (hasRepoCodex || hasUserCodex) {
      const scope = hasRepoCodex ? "repo" : "user";
      const codexResult = installCodexHooks({ scope, target: scope === "repo" ? target : undefined, gxpmRoot });
      results.codexHooks = codexResult.installedScripts;
    }
  }

  // 4. Skills
  if (!options.skipSkills) {
    results.skills = installSkill({ hostName: "all", root: gxpmRoot });
  }

  // 5. Default config
  const configPath = ensureDefaultConfig(target);
  if (configPath) results.config.push(configPath);

  // Output
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ target, ...results }, null, 2));
    return;
  }

  console.log(`gxpm init completed for ${target}`);
  console.log("");
  console.log(`Created directories: ${results.dirs.length}`);
  for (const d of results.dirs) console.log(`  ${d}`);
  console.log("");
  console.log(`Installed git hooks: ${results.hooks.length}`);
  for (const h of results.hooks) console.log(`  ${h}`);
  if (results.codexHooks.length > 0) {
    console.log("");
    console.log(`Installed Codex hooks: ${results.codexHooks.length}`);
    for (const h of results.codexHooks) console.log(`  ${h}`);
  }
  console.log("");
  console.log(`Installed skills: ${results.skills.length}`);
  for (const s of results.skills) console.log(`  ${s}`);
  if (results.config.length > 0) {
    console.log("");
    console.log(`Initialized config: ${results.config[0]}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("  gxpm config list");
  console.log("  gxpm doctor --json");
  console.log("  gxpm verify");
}
