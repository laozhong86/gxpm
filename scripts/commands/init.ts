import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installCodexHooks } from "../install-codex-hooks";
import { installSkill } from "../install-skill";
import { probeHosts, detectedHostNames } from "../../core/host-probe";
import type { HostProbeResult } from "../../core/host-probe";
import type { HostName } from "../../hosts";

interface InitOptions {
  target?: string;
  nonInteractive?: boolean;
  skipHooks?: boolean;
  skipSkills?: boolean;
  skipCodexHooks?: boolean;
  /** Explicit comma-separated host list, e.g. "claude,codex" */
  hosts?: string;
}

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

function isTty(): boolean {
  try {
    return (process.stdin as any).isTTY === true && (process.stdout as any).isTTY === true;
  } catch {
    return false;
  }
}

/**
 * Resolve which hosts to configure.
 *
 * Priority:
 *   1. --hosts <list>  → explicit override
 *   2. --non-interactive → auto-select all detected hosts
 *   3. TTY interactive → probe, print table, prompt user
 *   4. Fallback → auto-select all detected hosts
 */
function resolveSelectedHosts(options: InitOptions, target: string): HostName[] {
  // 1. Explicit --hosts override
  if (options.hosts) {
    const names = options.hosts.split(",").map((s) => s.trim()).filter(Boolean) as HostName[];
    return names;
  }

  const probed = probeHosts(target);
  const detected = probed.filter((r) => r.detected);

  // Nothing detected → empty (user can still --hosts)
  if (detected.length === 0) {
    return [];
  }

  // 2. Non-interactive → auto-select detected
  if (options.nonInteractive) {
    return detected.map((r) => r.host);
  }

  // 3. TTY interactive → show detection table, prompt
  if (isTty()) {
    return promptHostSelection(detected, probed);
  }

  // 4. Fallback → auto-select detected
  return detected.map((r) => r.host);
}

function promptHostSelection(detected: HostProbeResult[], all: HostProbeResult[]): HostName[] {
  console.log("");
  console.log("Detected agent CLIs:");
  console.log("  Host        CLI     Repo Config  User Config");
  console.log("  ─────────────────────────────────────────────");
  for (const r of all) {
    const mark = r.detected ? "✓" : " ";
    const cli = r.cliInstalled ? "✓" : " ";
    const repo = r.repoConfigExists ? "✓" : " ";
    const user = r.userConfigExists ? "✓" : " ";
    console.log(`  ${mark} ${r.host.padEnd(10)} ${cli}       ${repo}            ${user}      ${r.displayName}`);
  }
  console.log("");

  // If only one detected, default to yes
  if (detected.length === 1) {
    const r = detected[0];
    process.stdout.write(`Configure gxpm for ${r.displayName}? [Y/n] `);
    const answer = readLineSync().trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      return [r.host];
    }
    return [];
  }

  // Multiple detected → ask each
  const selected: HostName[] = [];
  for (const r of detected) {
    process.stdout.write(`Configure gxpm for ${r.displayName}? [Y/n] `);
    const answer = readLineSync().trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      selected.push(r.host);
    }
  }
  return selected;
}

function readLineSync(): string {
  const buffer = Buffer.alloc(1024);
  let result = "";
  while (true) {
    const bytesRead = readSync(0, buffer, 0, 1024, null);
    if (bytesRead === 0) break;
    const chunk = buffer.toString("utf8", 0, bytesRead);
    result += chunk;
    if (chunk.includes("\n")) break;
  }
  return result;
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
    } else if (arg === "--hosts") {
      options.hosts = argv[++i];
    }
    i++;
  }

  const target = resolve(options.target ?? process.cwd());
  const gxpmRoot = resolve(import.meta.dir, "../..");

  if (!isGitRepo(target)) {
    throw new Error(`Not a git repository: ${target}. gxpm requires git.`);
  }

  // Resolve which hosts to configure
  const selectedHosts = resolveSelectedHosts(options, target);

  const results: Record<string, string[] | string> = {
    dirs: [],
    hooks: [],
    codexHooks: [],
    skills: [],
    config: [],
    hostsConfigured: selectedHosts.join(",") || "none",
  };

  // 1. Ensure .gxpm/ directory structure
  results.dirs = ensureGxpmDir(target);

  // 2. Git hooks (always, host-agnostic)
  if (!options.skipHooks) {
    results.hooks = installGitHooks(target, gxpmRoot);
  }

  // 3. Codex hooks (only if codex is among selected hosts)
  if (!options.skipCodexHooks && selectedHosts.includes("codex")) {
    const hasRepoCodex = existsSync(join(target, ".codex"));
    const hasUserCodex = existsSync(join(homedir(), ".codex"));
    if (hasRepoCodex || hasUserCodex) {
      const scope = hasRepoCodex ? "repo" : "user";
      const codexResult = installCodexHooks({ scope, target: scope === "repo" ? target : undefined, gxpmRoot });
      results.codexHooks = codexResult.installedScripts;
    }
  }

  // 4. Skills (only for selected hosts)
  if (!options.skipSkills && selectedHosts.length > 0) {
    results.skills = installSkill({ hosts: selectedHosts, root: gxpmRoot });
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
  console.log(`Hosts configured: ${results.hostsConfigured}`);
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
  if (results.skills.length > 0) {
    console.log("");
    console.log(`Installed skills: ${results.skills.length}`);
    for (const s of results.skills) console.log(`  ${s}`);
  }
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
