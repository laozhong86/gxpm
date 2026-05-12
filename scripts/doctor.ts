import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ALL_HOST_CONFIGS } from "../hosts";
import { getConfigValue, getResolvedConfigValue, type KnownConfigKey, KNOWN_CONFIG_KEYS } from "../core/config";
import { readGxpmVersion } from "./version";

export interface SkillCheck {
  host: string;
  installPath: string;
  installed: boolean;
  bytes?: number;
}

export interface RepoCheck {
  cwd: string;
  isGitRepo: boolean;
  coreHooksPath: string | null;
  gxpmHooksInstalled: boolean;
  installedHooks: string[];
  gxpmDirExists: boolean;
  issueCount: number;
  contextMdExists: boolean;
}

export interface RuntimeCheck {
  bunAvailable: boolean;
  gxpmVersion: string | null;
  gxpmRepoRoot: string;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  schema_version: number;
  status: "healthy" | "warnings" | "error";
  health_score: number;
  checks: DoctorCheck[];
  // Legacy fields preserved for backward compatibility
  runtime?: RuntimeCheck;
  skill?: SkillCheck[];
  repo?: RepoCheck;
}

interface RunDoctorInput {
  home?: string;
  cwd?: string;
  gxpmRoot?: string;
  fix?: boolean;
}

const GXPM_HOOK_FILES = [
  "gxpm-pre-commit",
  "gxpm-commit-msg",
  "gxpm-pre-push",
  "gxpm-post-merge",
];

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

export function runDoctor(input: RunDoctorInput = {}): DoctorReport {
  const home = input.home ?? homedir();
  const cwd = input.cwd ?? process.cwd();
  const gxpmRoot = input.gxpmRoot ?? DEFAULT_GXPM_ROOT;
  const fix = input.fix ?? false;

  const runtime = checkRuntime(gxpmRoot);
  const skillChecks = checkSkill(home);
  const repo = checkRepo(cwd);

  const checks: DoctorCheck[] = [];
  const fixLog: string[] = [];

  // --- Runtime checks ---
  checks.push({
    name: "bun_runtime",
    status: runtime.bunAvailable ? "ok" : "fail",
    message: runtime.bunAvailable ? "bun is available" : "bun not found on PATH",
  });

  checks.push({
    name: "gxpm_version",
    status: runtime.gxpmVersion ? "ok" : "warn",
    message: runtime.gxpmVersion ? `gxpm ${runtime.gxpmVersion} at ${runtime.gxpmRepoRoot}` : "could not read VERSION",
  });

  // --- Skill checks ---
  const missingSkills = skillChecks.filter((s) => !s.installed);
  if (missingSkills.length === 0) {
    checks.push({ name: "skill_installation", status: "ok", message: `${skillChecks.length} hosts have gxpm skill` });
  } else {
    checks.push({
      name: "skill_installation",
      status: "warn",
      message: `${missingSkills.length} missing skill installations: ${missingSkills.map((s) => s.host).join(", ")}`,
    });
    if (fix) {
      try {
        execSync(`bun run "${join(gxpmRoot, "scripts", "install-skill.ts")}" --host all`, { stdio: "ignore" });
        fixLog.push("installed missing skills to all hosts");
      } catch {
        fixLog.push("failed to install missing skills");
      }
    }
  }

  // --- Skill freshness ---
  const stale = checkSkillFreshness(gxpmRoot);
  if (stale.length === 0) {
    checks.push({ name: "skill_freshness", status: "ok", message: "all SKILL.md files are up to date with templates" });
  } else {
    checks.push({
      name: "skill_freshness",
      status: "warn",
      message: `${stale.length} stale SKILL.md files: ${stale.join(", ")}`,
    });
    if (fix) {
      try {
        execSync(`bun run "${join(gxpmRoot, "scripts", "gen-skill-docs.ts")}"`, { stdio: "ignore" });
        fixLog.push("regenerated skill docs");
      } catch {
        fixLog.push("failed to regenerate skill docs");
      }
    }
  }

  // --- Repo checks ---
  if (!repo.isGitRepo) {
    checks.push({ name: "git_repo", status: "fail", message: "not a git repository" });
  } else {
    checks.push({ name: "git_repo", status: "ok", message: "git repository detected" });
  }

  if (repo.gxpmHooksInstalled) {
    checks.push({ name: "gxpm_hooks", status: "ok", message: `all ${GXPM_HOOK_FILES.length} hooks installed` });
  } else {
    const missing = GXPM_HOOK_FILES.filter((h) => !repo.installedHooks.includes(h));
    checks.push({
      name: "gxpm_hooks",
      status: repo.isGitRepo ? "warn" : "fail",
      message: `missing hooks: ${missing.join(", ")}`,
    });
    if (fix && repo.isGitRepo) {
      try {
        execSync(`bun run "${join(gxpmRoot, "scripts", "install-hooks.ts")}" --target "${cwd}"`, { stdio: "ignore" });
        fixLog.push("installed missing git hooks");
      } catch {
        fixLog.push("failed to install git hooks");
      }
    }
  }

  if (repo.gxpmDirExists) {
    checks.push({ name: "gxpm_dir", status: "ok", message: `.gxpm/issues/ exists (${repo.issueCount} issues)` });
  } else {
    checks.push({ name: "gxpm_dir", status: "warn", message: ".gxpm/ not initialized" });
  }

  // --- Worktree availability ---
  if (repo.isGitRepo) {
    try {
      execSync("git worktree list", { cwd, stdio: "ignore" });
      checks.push({ name: "worktree_available", status: "ok", message: "git worktree is available" });
    } catch {
      checks.push({ name: "worktree_available", status: "warn", message: "git worktree command failed" });
    }
  }

  // --- Config validity ---
  const configIssues = checkConfigValidity(cwd, home);
  if (configIssues.length === 0) {
    checks.push({ name: "config_validity", status: "ok", message: "all config values are valid" });
  } else {
    checks.push({ name: "config_validity", status: "warn", message: configIssues.join("; ") });
  }

  // --- Linear CLI availability (if configured) ---
  const provider = getConfigValue({ root: cwd, home, key: "sync.provider" });
  if (provider.value === "linear") {
    const linearOk = checkLinearQuick();
    checks.push({
      name: "linear_cli",
      status: linearOk ? "ok" : "warn",
      message: linearOk ? "Linear CLI available" : "Linear CLI not found (install with `npm install -g @linear/cli` or equivalent)",
    });
  }

  // --- Upgrade error trail ---
  const upgradeErrors = loadUpgradeErrors();
  if (upgradeErrors.length > 0) {
    const latest = upgradeErrors[upgradeErrors.length - 1];
    checks.push({
      name: "upgrade_errors",
      status: "warn",
      message: `Post-upgrade failure on ${latest.ts.slice(0, 10)} (${latest.from_version} -> ${latest.to_version}, phase: ${latest.phase}). Recovery: ${latest.hint}`,
    });
  }

  // Compute health score
  let score = 100;
  for (const c of checks) {
    if (c.status === "fail") score -= 20;
    else if (c.status === "warn") score -= 5;
  }
  score = Math.max(0, score);

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const status: DoctorReport["status"] = hasFail ? "error" : hasWarn ? "warnings" : "healthy";

  // Write fix log if any fixes were applied
  if (fix && fixLog.length > 0) {
    const auditDir = join(home, ".gxpm", "audit");
    mkdirSync(auditDir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), fixes: fixLog }) + "\n";
    writeFileSync(join(auditDir, "doctor-fixes.jsonl"), line, { flag: "a" });
  }

  return {
    schema_version: 1,
    status,
    health_score: score,
    checks,
    runtime,
    skill: skillChecks,
    repo,
  };
}

function checkRuntime(gxpmRoot: string): RuntimeCheck {
  let bunAvailable = false;
  try {
    execSync("bun --version", { stdio: "ignore" });
    bunAvailable = true;
  } catch {}

  let version: string | null = null;
  try {
    version = readGxpmVersion({ root: gxpmRoot });
  } catch {}

  return { bunAvailable, gxpmVersion: version, gxpmRepoRoot: gxpmRoot };
}

function checkSkill(home: string): SkillCheck[] {
  return ALL_HOST_CONFIGS.map((host) => {
    const installPath = join(home, host.globalRoot, "SKILL.md");
    if (!existsSync(installPath)) {
      return { host: host.name, installPath, installed: false };
    }
    let bytes: number | undefined;
    try {
      bytes = statSync(installPath).size;
    } catch {}
    return { host: host.name, installPath, installed: true, bytes };
  });
}

function checkRepo(cwd: string): RepoCheck {
  const repo: RepoCheck = {
    cwd,
    isGitRepo: false,
    coreHooksPath: null,
    gxpmHooksInstalled: false,
    installedHooks: [],
    gxpmDirExists: false,
    issueCount: 0,
    contextMdExists: existsSync(join(cwd, "CONTEXT.md")),
  };

  const gitDir = join(cwd, ".git");
  try {
    repo.isGitRepo = existsSync(gitDir) && statSync(gitDir).isDirectory();
  } catch {}

  if (repo.isGitRepo) {
    try {
      repo.coreHooksPath = execSync("git config core.hooksPath", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      repo.coreHooksPath = null;
    }
  }

  const hooksDir = join(cwd, ".githooks");
  if (existsSync(hooksDir)) {
    for (const hook of GXPM_HOOK_FILES) {
      if (existsSync(join(hooksDir, hook))) {
        repo.installedHooks.push(hook);
      }
    }
    repo.gxpmHooksInstalled = repo.installedHooks.length === GXPM_HOOK_FILES.length;
  }

  const gxpmDir = join(cwd, ".gxpm", "issues");
  if (existsSync(gxpmDir)) {
    repo.gxpmDirExists = true;
    try {
      repo.issueCount = readdirSync(gxpmDir).filter((name) => {
        const p = join(gxpmDir, name);
        try {
          return statSync(p).isDirectory() && existsSync(join(p, "state.json"));
        } catch {
          return false;
        }
      }).length;
    } catch {}
  }

  return repo;
}

function checkSkillFreshness(gxpmRoot: string): string[] {
  const stale: string[] = [];
  const skillsDir = join(gxpmRoot, "skills");
  if (!existsSync(skillsDir)) return stale;

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(skillsDir, entry.name);
    const tmplPath = join(skillDir, "SKILL.md.tmpl");
    const skillPath = join(skillDir, "SKILL.md");
    if (!existsSync(tmplPath) || !existsSync(skillPath)) continue;
    try {
      const tmplStat = statSync(tmplPath);
      const skillStat = statSync(skillPath);
      if (tmplStat.mtimeMs > skillStat.mtimeMs) {
        stale.push(entry.name);
      }
    } catch {
      // skip
    }
  }
  return stale;
}

function checkConfigValidity(cwd: string, home: string): string[] {
  const issues: string[] = [];
  for (const key of KNOWN_CONFIG_KEYS) {
    try {
      const resolved = getResolvedConfigValue({ root: cwd, home, key });
      // Basic type checks based on registry knowledge would go here;
      // for now we just ensure the value can be resolved without throwing.
    } catch (e) {
      issues.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return issues;
}

function checkLinearQuick(): boolean {
  try {
    execSync("linear --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PATH: process.env.PATH },
    });
    return true;
  } catch {
    return false;
  }
}

function loadUpgradeErrors(): Array<{ ts: string; phase: string; from_version: string; to_version: string; hint: string }> {
  try {
    const path = join(homedir(), ".gxpm", "audit", "upgrade-errors.jsonl");
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim());
    return lines.map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("gxpm doctor");
  lines.push("===========");
  lines.push("");
  lines.push(`Status: ${report.status} (score: ${report.health_score}/100)`);
  lines.push("");

  for (const c of report.checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
    lines.push(`  ${icon} ${c.name}: ${c.message}`);
  }

  lines.push("");
  if (report.status === "healthy") {
    lines.push("All checks passed.");
  } else if (report.status === "warnings") {
    lines.push("Some warnings found. Run `gxpm doctor --fix` to auto-repair where possible.");
  } else {
    lines.push("Failing checks found. Run `gxpm doctor --fix` to auto-repair where possible.");
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const fix = Bun.argv.includes("--fix");
  const report = runDoctor({ fix });
  console.log(formatDoctorReport(report));
  process.exit(report.status === "error" ? 1 : 0);
}
