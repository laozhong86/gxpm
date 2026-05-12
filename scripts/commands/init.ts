import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installClaudeHooks } from "../install-claude-hooks";
import { installCodexHooks } from "../install-codex-hooks";
import { installKimiHooks } from "../install-kimi-hooks";
import { installSkill } from "../install-skill";
import { probeHosts, detectedHostNames } from "../../core/host-probe";
import type { HostProbeResult } from "../../core/host-probe";
import type { HostName } from "../../hosts";
import { getConfigValue, parseAgentsMdConfig } from "../../core/config";

interface InitOptions {
  target?: string;
  nonInteractive?: boolean;
  skipHooks?: boolean;
  skipSkills?: boolean;
  skipCodexHooks?: boolean;
  baseBranch?: string;
  /** Explicit comma-separated host list, e.g. "claude,codex" */
  hosts?: string;
}

type BaseBranchSource = "option" | "config" | "agents-md" | "claude-md" | "git-branch" | "prompt";

interface BaseBranchResolution {
  branch: string;
  source: BaseBranchSource;
  candidates: string[];
}

const HOOK_SPECS: { gxpmFile: string; topLevelFile: string; argsForwarding: string }[] = [
  { gxpmFile: "gxpm-pre-commit", topLevelFile: "pre-commit", argsForwarding: "" },
  { gxpmFile: "gxpm-commit-msg", topLevelFile: "commit-msg", argsForwarding: ' "$1"' },
  { gxpmFile: "gxpm-pre-push", topLevelFile: "pre-push", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-merge", topLevelFile: "post-merge", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-checkout", topLevelFile: "post-checkout", argsForwarding: ' "$@"' },
];

const GXPM_GITIGNORE_ENTRY = ".gxpm/";
const GXPM_GITIGNORE_EQUIVALENTS = new Set([".gxpm", ".gxpm/", "/.gxpm", "/.gxpm/"]);
const CORE_BASE_BRANCHES = ["main", "master", "develop", "development", "dev", "trunk"] as const;

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

function ensureGxpmGitignore(target: string): string | null {
  const gitignorePath = join(target, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${GXPM_GITIGNORE_ENTRY}\n`);
    return gitignorePath;
  }

  const current = readFileSync(gitignorePath, "utf8");
  const hasEntry = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => GXPM_GITIGNORE_EQUIVALENTS.has(line));
  if (hasEntry) return null;

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${current}${prefix}${GXPM_GITIGNORE_ENTRY}\n`);
  return gitignorePath;
}

function ensureDefaultConfig(target: string, baseBranch: string, overwriteBaseBranch = false): string | null {
  const configPath = join(target, ".gxpm", "config.json");
  if (existsSync(configPath)) {
    const existing = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const worktree = (existing.worktree ?? {}) as Record<string, unknown>;
    if (!overwriteBaseBranch && typeof worktree.baseBranch === "string" && worktree.baseBranch.trim()) {
      return null;
    }
    existing.worktree = { ...worktree, baseBranch };
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
    return configPath;
  }

  const defaultConfig = {
    worktree: { enforcement: "optional", default: "ask", baseBranch },
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

function normalizeBranchName(raw: string): string {
  return raw
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

function normalizeRemoteBranchName(raw: string): string {
  const normalized = normalizeBranchName(raw);
  const slash = normalized.indexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function readDocumentBaseBranch(target: string, filename: "AGENTS.md" | "CLAUDE.md"): string | undefined {
  const path = join(target, filename);
  if (!existsSync(path)) return undefined;
  const parsed = parseAgentsMdConfig(readFileSync(path, "utf8"));
  const branch = ((parsed.worktree ?? {}) as { baseBranch?: string }).baseBranch;
  return typeof branch === "string" && branch.trim() ? normalizeBranchName(branch) : undefined;
}

function listLikelyBaseBranches(target: string): string[] {
  const branchNames = new Set<string>();

  const collect = (cmd: string[], remote = false) => {
    const result = Bun.spawnSync({
      cmd,
      cwd: target,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return;
    for (const line of result.stdout.toString().split("\n")) {
      const value = line.trim();
      if (!value || value.includes(" -> ") || value.endsWith("/HEAD")) continue;
      branchNames.add(remote ? normalizeRemoteBranchName(value) : normalizeBranchName(value));
    }
  };

  collect(["git", "branch", "--format=%(refname:short)"]);
  collect(["git", "branch", "-r", "--format=%(refname:short)"], true);
  collect(["git", "branch", "--show-current"]);

  return CORE_BASE_BRANCHES.filter((branch) => branchNames.has(branch));
}

function promptBaseBranch(candidates: string[]): BaseBranchResolution {
  console.log("");
  if (candidates.length > 0) {
    console.log("Multiple likely base branches detected:");
    candidates.forEach((branch, index) => console.log(`  ${index + 1}. ${branch}`));
    process.stdout.write(`Select gxpm worktree base branch [${candidates[0]}]: `);
  } else {
    console.log("gxpm could not infer a worktree base branch from AGENTS.md, CLAUDE.md, or git branches.");
    process.stdout.write("Enter gxpm worktree base branch: ");
  }

  const answer = readLineSync().trim();
  if (answer === "" && candidates.length > 0) {
    return { branch: candidates[0], source: "prompt", candidates };
  }

  const selected = candidates[Number(answer) - 1] ?? answer;
  const branch = normalizeBranchName(selected);
  if (!branch) {
    throw new Error("Base branch cannot be empty. Re-run gxpm init --base-branch <branch>.");
  }
  return { branch, source: "prompt", candidates };
}

function resolveInitBaseBranch(options: InitOptions, target: string): BaseBranchResolution {
  if (options.baseBranch) {
    return { branch: normalizeBranchName(options.baseBranch), source: "option", candidates: [] };
  }

  const configured = getConfigValue({ root: target, key: "worktree.baseBranch" });
  if (typeof configured.value === "string" && configured.value.trim()) {
    return { branch: normalizeBranchName(configured.value), source: "config", candidates: [] };
  }

  const docCandidates = [
    { source: "agents-md" as const, branch: readDocumentBaseBranch(target, "AGENTS.md") },
    { source: "claude-md" as const, branch: readDocumentBaseBranch(target, "CLAUDE.md") },
  ].filter((item): item is { source: "agents-md" | "claude-md"; branch: string } => !!item.branch);
  const uniqueDocBranches = Array.from(new Set(docCandidates.map((item) => item.branch)));
  if (uniqueDocBranches.length === 1) {
    return {
      branch: uniqueDocBranches[0],
      source: docCandidates.find((item) => item.branch === uniqueDocBranches[0])?.source ?? "agents-md",
      candidates: uniqueDocBranches,
    };
  }
  if (uniqueDocBranches.length > 1) {
    if (!options.nonInteractive && isTty()) return promptBaseBranch(uniqueDocBranches);
    throw new Error(
      `Conflicting gxpm worktree.baseBranch values found in AGENTS.md/CLAUDE.md: ${uniqueDocBranches.join(", ")}. ` +
        "Re-run gxpm init --base-branch <branch>.",
    );
  }

  const candidates = listLikelyBaseBranches(target);
  if (candidates.length === 1) {
    return { branch: candidates[0], source: "git-branch", candidates };
  }
  if (candidates.length > 1) {
    if (!options.nonInteractive && isTty()) return promptBaseBranch(candidates);
    throw new Error(
      `Multiple likely base branches found: ${candidates.join(", ")}. ` +
        "Re-run gxpm init --base-branch <branch> or add worktree.baseBranch to AGENTS.md/CLAUDE.md.",
    );
  }
  if (!options.nonInteractive && isTty()) return promptBaseBranch(candidates);
  throw new Error(
    "Could not infer gxpm worktree base branch. Re-run gxpm init --base-branch <branch> " +
      "or add worktree.baseBranch to AGENTS.md/CLAUDE.md.",
  );
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
    } else if (arg === "--base-branch") {
      options.baseBranch = argv[++i];
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

  const baseBranch = resolveInitBaseBranch(options, target);

  // Resolve which hosts to configure
  const selectedHosts = resolveSelectedHosts(options, target);

  const results: Record<string, string[] | string> = {
    dirs: [],
    hooks: [],
    claudeHooks: [],
    codexHooks: [],
    kimiHooks: [],
    skills: [],
    config: [],
    gitignore: [],
    hostsConfigured: selectedHosts.join(",") || "none",
    baseBranch: `${baseBranch.branch} (${baseBranch.source})`,
  };

  // 1. Ensure .gxpm/ directory structure
  results.dirs = ensureGxpmDir(target);
  const gitignorePath = ensureGxpmGitignore(target);
  if (gitignorePath) results.gitignore.push(gitignorePath);

  // 2. Git hooks (always, host-agnostic)
  if (!options.skipHooks) {
    results.hooks = installGitHooks(target, gxpmRoot);
  }

  // 3. Claude hooks (only if claude is among selected hosts)
  if (selectedHosts.includes("claude")) {
    const hasRepoClaude = existsSync(join(target, ".claude"));
    const hasUserClaude = existsSync(join(homedir(), ".claude"));
    if (hasRepoClaude || hasUserClaude) {
      const scope = hasRepoClaude ? "repo" : "user";
      const claudeResult = installClaudeHooks({ scope, target: scope === "repo" ? target : undefined });
      results.claudeHooks = [claudeResult.settingsJsonPath];
    }
  }

  // 4. Codex hooks (only if codex is among selected hosts)
  if (!options.skipCodexHooks && selectedHosts.includes("codex")) {
    const hasRepoCodex = existsSync(join(target, ".codex"));
    const hasUserCodex = existsSync(join(homedir(), ".codex"));
    if (hasRepoCodex || hasUserCodex) {
      const scope = hasRepoCodex ? "repo" : "user";
      installCodexHooks({ scope, target: scope === "repo" ? target : undefined, gxpmRoot });
      results.codexHooks = ["hooks.json installed"];
    }
  }

  // 5. Kimi hooks (only if kimi is among selected hosts)
  if (selectedHosts.includes("kimi")) {
    const kimiResult = installKimiHooks();
    results.kimiHooks = [kimiResult.configTomlPath];
  }

  // 4. Skills (only for selected hosts)
  if (!options.skipSkills && selectedHosts.length > 0) {
    results.skills = installSkill({ hosts: selectedHosts, root: gxpmRoot });
  }

  // 5. Default config
  const configPath = ensureDefaultConfig(target, baseBranch.branch, baseBranch.source === "option");
  if (configPath) results.config.push(configPath);

  // Output
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ target, ...results }, null, 2));
    return;
  }

  console.log(`gxpm init completed for ${target}`);
  console.log("");
  console.log(`Hosts configured: ${results.hostsConfigured}`);
  console.log(`Base branch: ${baseBranch.branch} (${baseBranch.source})`);
  console.log("");
  console.log(`Created directories: ${results.dirs.length}`);
  for (const d of results.dirs) console.log(`  ${d}`);
  if (results.gitignore.length > 0) {
    console.log("");
    console.log(`Updated gitignore: ${results.gitignore.length}`);
    for (const path of results.gitignore) console.log(`  ${path}`);
  }
  console.log("");
  console.log(`Installed git hooks: ${results.hooks.length}`);
  for (const h of results.hooks) console.log(`  ${h}`);
  if (results.claudeHooks.length > 0) {
    console.log("");
    console.log(`Installed Claude hooks: ${results.claudeHooks.length}`);
    for (const h of results.claudeHooks) console.log(`  ${h}`);
  }
  if (results.kimiHooks.length > 0) {
    console.log("");
    console.log(`Installed Kimi hooks: ${results.kimiHooks.length}`);
    for (const h of results.kimiHooks) console.log(`  ${h}`);
  }
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
