import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ALL_HOST_CONFIGS } from "../hosts";

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
}

export interface RuntimeCheck {
  bunAvailable: boolean;
  gxpmVersion: string | null;
  gxpmRepoRoot: string;
}

export interface DoctorReport {
  runtime: RuntimeCheck;
  skill: SkillCheck[];
  repo: RepoCheck;
}

interface RunDoctorInput {
  home?: string;
  cwd?: string;
  gxpmRoot?: string;
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

  return {
    runtime: checkRuntime(gxpmRoot),
    skill: checkSkill(home),
    repo: checkRepo(cwd),
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
    const pkg = JSON.parse(readFileSync(join(gxpmRoot, "package.json"), "utf8")) as {
      version?: string;
    };
    version = pkg.version ?? null;
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
  };

  // git repo?
  const gitDir = join(cwd, ".git");
  try {
    repo.isGitRepo = existsSync(gitDir) && statSync(gitDir).isDirectory();
  } catch {}

  // core.hooksPath
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

  // gxpm hooks installed?
  const hooksDir = join(cwd, ".githooks");
  if (existsSync(hooksDir)) {
    for (const hook of GXPM_HOOK_FILES) {
      if (existsSync(join(hooksDir, hook))) {
        repo.installedHooks.push(hook);
      }
    }
    repo.gxpmHooksInstalled = repo.installedHooks.length === GXPM_HOOK_FILES.length;
  }

  // .gxpm/ exists + count
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

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  lines.push("gxpm doctor");
  lines.push("===========");
  lines.push("");

  // Runtime
  lines.push("Runtime:");
  lines.push(`  ${report.runtime.bunAvailable ? "✓" : "✗"} bun available`);
  lines.push(
    `  ${report.runtime.gxpmVersion ? "✓" : "✗"} gxpm ${report.runtime.gxpmVersion ?? "<unknown>"} at ${report.runtime.gxpmRepoRoot}`,
  );
  lines.push("");

  // Skill
  lines.push("Skill installation:");
  for (const skill of report.skill) {
    const mark = skill.installed ? "✓" : "✗";
    const detail = skill.installed && skill.bytes ? ` (${skill.bytes} bytes)` : "";
    lines.push(`  ${mark} ${skill.host} → ${skill.installPath}${detail}`);
  }
  if (report.skill.some((s) => !s.installed)) {
    lines.push("    Fix: gxpm-init --install-skill --host all");
  }
  lines.push("");

  // Repo
  lines.push(`Current repo (${report.repo.cwd}):`);
  if (!report.repo.isGitRepo) {
    lines.push("  ✗ not a git repository — gxpm hooks require git");
  } else {
    lines.push("  ✓ git repository");
    const cph = report.repo.coreHooksPath;
    if (cph === ".githooks") {
      lines.push("  ✓ git core.hooksPath = .githooks");
    } else {
      lines.push(`  ✗ git core.hooksPath = ${cph ?? "<unset>"}`);
    }
    if (report.repo.gxpmHooksInstalled) {
      lines.push(`  ✓ all 4 gxpm hooks installed (${report.repo.installedHooks.join(", ")})`);
    } else {
      const missing = GXPM_HOOK_FILES.filter((h) => !report.repo.installedHooks.includes(h));
      lines.push(`  ✗ missing gxpm hooks: ${missing.join(", ") || "<none>"}`);
      lines.push("    Fix: gxpm-init --install-hooks --target .");
    }
    if (report.repo.gxpmDirExists) {
      lines.push(`  ✓ .gxpm/issues/ exists (${report.repo.issueCount} issue${report.repo.issueCount === 1 ? "" : "s"} tracked)`);
    } else {
      lines.push("  · no .gxpm/issues/ yet (run 'gxpm issue create <id>' to start)");
    }
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const report = runDoctor();
  console.log(formatDoctorReport(report));
}
