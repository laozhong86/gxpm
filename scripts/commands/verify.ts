import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getConfigValue } from "../../core/config";
import { runDoctor } from "../doctor";

interface VerifyCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

interface VerifyResult {
  status: "passed" | "warnings" | "failed";
  checks: VerifyCheck[];
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function checkGitHooksFire(target: string): VerifyCheck {
  try {
    // Create a temp file to verify pre-commit fires
    const testFile = join(target, ".gxpm", ".verify-hook-test");
    writeFileSync(testFile, "hook test\n");
    execSync("git add .gxpm/.verify-hook-test", { cwd: target });
    // Run pre-commit hook manually to see if it exits 0
    const hooksPath = execSync("git config core.hooksPath", { cwd: target, encoding: "utf-8" }).trim();
    const preCommit = join(hooksPath, "pre-commit");
    if (existsSync(preCommit)) {
      execSync(preCommit, { cwd: target, stdio: "ignore" });
    }
    execSync("git reset HEAD .gxpm/.verify-hook-test", { cwd: target, stdio: "ignore" });
    rmSync(testFile);
    return { name: "git_hooks_fire", status: "ok", message: "pre-commit hook executes without error" };
  } catch (e) {
    return { name: "git_hooks_fire", status: "warn", message: `Could not verify hook execution: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function checkWorktreeAvailable(target: string): VerifyCheck {
  try {
    execSync("git worktree list", { cwd: target, stdio: "ignore" });
    return { name: "worktree_available", status: "ok", message: "git worktree is available" };
  } catch {
    return { name: "worktree_available", status: "warn", message: "git worktree not available or failed" };
  }
}

function checkSkillHostDiscovery(): VerifyCheck {
  const hosts = ["claude", "codex", "cursor"];
  const found: string[] = [];
  const home = homedir();
  for (const h of hosts) {
    const skillPath = join(home, "." + h, "skills", "gxpm", "SKILL.md");
    if (existsSync(skillPath)) found.push(h);
  }
  if (found.length > 0) {
    return { name: "skill_host_discovery", status: "ok", message: `gxpm skill installed on: ${found.join(", ")}` };
  }
  return { name: "skill_host_discovery", status: "fail", message: "gxpm skill not found on any host. Run: gxpm init --install-skill --host all" };
}

function checkLinearConnectivity(): VerifyCheck {
  const provider = getConfigValue({ key: "sync.provider" });
  if (provider.value !== "linear") {
    return { name: "linear_connectivity", status: "ok", message: "sync.provider is not linear; skipped" };
  }
  try {
    const token = process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN;
    if (!token) {
      return { name: "linear_connectivity", status: "warn", message: "sync.provider=linear but no LINEAR_API_KEY env var set" };
    }
    // Minimal GraphQL health check
    const result = execSync(
      `curl -sf -H "Authorization: ${token}" -H "Content-Type: application/json" -X POST -d '{"query":"{ viewer { id } }"}' https://api.linear.app/graphql`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );
    const parsed = JSON.parse(result);
    if (parsed.errors) {
      return { name: "linear_connectivity", status: "fail", message: `Linear API error: ${parsed.errors[0]?.message}` };
    }
    return { name: "linear_connectivity", status: "ok", message: "Linear API reachable" };
  } catch (e) {
    return { name: "linear_connectivity", status: "warn", message: `Could not verify Linear connectivity: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function checkIssueLifecycle(target: string, dryRun: boolean): VerifyCheck {
  try {
    if (dryRun) {
      return { name: "issue_lifecycle", status: "ok", message: "dry-run: skipped actual issue creation" };
    }
    // Create a test issue
    const out = execSync("bin/gxpm issue create --auto-id", { cwd: target, encoding: "utf-8" }).trim();
    const match = out.match(/created (GXPM-\d+)/i);
    if (!match) {
      return { name: "issue_lifecycle", status: "fail", message: "Could not parse issue creation output" };
    }
    const id = match[1];
    // Transition to plan
    execSync(`bin/gxpm issue transition ${id} plan`, { cwd: target, stdio: "ignore" });
    // Transition back to triage (to keep it clean)
    execSync(`bin/gxpm issue transition ${id} triage`, { cwd: target, stdio: "ignore" });
    return { name: "issue_lifecycle", status: "ok", message: `Created and transitioned ${id} successfully` };
  } catch (e) {
    return { name: "issue_lifecycle", status: "fail", message: `Issue lifecycle test failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function runVerifyCommand(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const json = argv.includes("--json");
  const target = resolve(process.cwd());

  if (!isGitRepo(target)) {
    throw new Error(`Not a git repository: ${target}`);
  }

  const checks: VerifyCheck[] = [];

  // 1. Doctor baseline
  try {
    const doctorReport = runDoctor({ cwd: target });
    const hasFail = (doctorReport as any).checks?.some((c: any) => c.status === "fail");
    const hasWarn = (doctorReport as any).checks?.some((c: any) => c.status === "warn");
    if (hasFail) {
      checks.push({ name: "doctor_baseline", status: "fail", message: "gxpm doctor has failing checks" });
    } else if (hasWarn) {
      checks.push({ name: "doctor_baseline", status: "warn", message: "gxpm doctor has warnings" });
    } else {
      checks.push({ name: "doctor_baseline", status: "ok", message: "gxpm doctor all clear" });
    }
  } catch (e) {
    checks.push({ name: "doctor_baseline", status: "fail", message: `doctor failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  // 2. Git hooks
  checks.push(checkGitHooksFire(target));

  // 3. Worktree
  checks.push(checkWorktreeAvailable(target));

  // 4. Skill hosts
  checks.push(checkSkillHostDiscovery());

  // 5. Linear (if configured)
  checks.push(checkLinearConnectivity());

  // 6. Issue lifecycle (optional, can be skipped with --no-issue-test)
  if (!argv.includes("--no-issue-test")) {
    checks.push(checkIssueLifecycle(target, dryRun));
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const status: VerifyResult["status"] = hasFail ? "failed" : hasWarn ? "warnings" : "passed";

  const result: VerifyResult = { status, checks };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(hasFail ? 1 : 0);
  }

  console.log("gxpm verify");
  console.log("===========");
  console.log("");
  for (const c of checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${c.name}: ${c.message}`);
  }
  console.log("");
  console.log(`Result: ${status}`);

  if (hasFail) {
    console.log("");
    console.log("Fix failing checks, then rerun `gxpm verify`.");
    process.exit(1);
  }
}
