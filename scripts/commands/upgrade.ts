import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readGxpmVersion } from "../version";

interface UpgradeOptions {
  dryRun?: boolean;
  skipPull?: boolean;
  skipInstall?: boolean;
}

function getGxpmRoot(): string {
  const envRoot = process.env.GXPM_DIR;
  if (envRoot) return resolve(envRoot);
  // Heuristic: find gxpm repo by locating the bin/gxpm binary on PATH
  try {
    const binPath = execSync("command -v gxpm", { encoding: "utf-8" }).trim();
    if (binPath) {
      // Resolve symlinks
      const realBin = execSync(`readlink -f "${binPath}" 2>/dev/null || echo "${binPath}"`, { encoding: "utf-8" }).trim();
      return resolve(realBin, "..", "..");
    }
  } catch {
    // fallthrough
  }
  // Fallback: assume cwd is gxpm repo
  return resolve(import.meta.dir, "../..");
}

function getCurrentBranch(root: string): string {
  return execSync("git branch --show-current", { cwd: root, encoding: "utf-8" }).trim();
}

function getLastLocalVersion(root: string): string | null {
  try {
    const prior = execSync("git show HEAD@{1}:VERSION", { cwd: root, encoding: "utf-8" }).trim();
    return prior;
  } catch {
    return null;
  }
}

function filesChangedSince(root: string, ref: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${ref}..HEAD`, { cwd: root, encoding: "utf-8" }).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

function listMigrationGuides(root: string, fromVersion: string, toVersion: string): string[] {
  const migrationsDir = join(root, "docs", "migrations");
  if (!existsSync(migrationsDir)) return [];

  const guides: string[] = [];
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith(".md")) continue;
    const match = file.match(/^v([0-9.]+)\.md$/);
    if (!match) continue;
    const v = match[1];
    // Simple semver-ish comparison: assume versions are like 0.1.0, 0.2.0
    if (compareSemver(v, fromVersion) > 0 && compareSemver(v, toVersion) <= 0) {
      guides.push(join(migrationsDir, file));
    }
  }
  return guides.sort((a, b) => compareSemver(parseVersionFromPath(a), parseVersionFromPath(b)));
}

function parseVersionFromPath(path: string): string {
  const base = path.split("/").pop() ?? "";
  const m = base.match(/^v([0-9.]+)\.md$/);
  return m?.[1] ?? "0.0.0";
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function logUpgradeError(root: string, phase: string, from: string, to: string, hint: string) {
  const auditDir = join(homedir(), ".gxpm", "audit");
  mkdirSync(auditDir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), phase, from_version: from, to_version: to, hint }) + "\n";
  const errPath = join(auditDir, "upgrade-errors.jsonl");
  const { writeFileSync } = require("node:fs");
  writeFileSync(errPath, line, { flag: "a" });
}

import { mkdirSync } from "node:fs";

export function runUpgradeCommand(argv: string[]) {
  const opts: UpgradeOptions = {
    dryRun: argv.includes("--dry-run"),
    skipPull: argv.includes("--skip-pull"),
    skipInstall: argv.includes("--skip-install"),
  };

  const root = getGxpmRoot();
  const currentVersion = readGxpmVersion({ root });
  const priorVersion = getLastLocalVersion(root);
  const branch = getCurrentBranch(root);

  if (branch !== "main" && branch !== "master") {
    console.warn(`Warning: current branch is '${branch}', not main/master. Upgrade may be unsafe.`);
  }

  const steps: string[] = [];

  // Step 1: git pull
  if (!opts.skipPull) {
    steps.push("git pull origin main");
    if (!opts.dryRun) {
      try {
        execSync("git pull origin main", { cwd: root, stdio: "inherit" });
      } catch (e) {
        const hint = "Resolve git conflicts manually, then rerun `gxpm upgrade`";
        logUpgradeError(root, "git_pull", priorVersion ?? "unknown", currentVersion, hint);
        throw new Error(`git pull failed. ${hint}`);
      }
    }
  }

  // Step 2: bun install
  if (!opts.skipInstall) {
    steps.push("bun install");
    if (!opts.dryRun) {
      try {
        execSync("bun install", { cwd: root, stdio: "inherit" });
      } catch (e) {
        const hint = "Check bun.lock conflicts and run `bun install` manually";
        logUpgradeError(root, "bun_install", priorVersion ?? "unknown", currentVersion, hint);
        throw new Error(`bun install failed. ${hint}`);
      }
    }
  }

  // Step 3: Detect template changes and regenerate skill docs
  const changed = opts.dryRun ? [] : filesChangedSince(root, "HEAD@{1}");
  const tmplChanged = changed.some((f) => f.endsWith(".tmpl"));
  const hooksChanged = changed.some((f) => f.startsWith("templates/hooks/"));

  if (tmplChanged) {
    steps.push("bun run gen:skill-docs (skill templates changed)");
    if (!opts.dryRun) {
      try {
        execSync("bun run gen:skill-docs", { cwd: root, stdio: "inherit" });
      } catch (e) {
        const hint = "Run `bun run gen:skill-docs` manually after fixing errors";
        logUpgradeError(root, "gen_skill_docs", priorVersion ?? "unknown", currentVersion, hint);
        throw new Error(`gen:skill-docs failed. ${hint}`);
      }
    }
  }

  if (hooksChanged) {
    steps.push("gxpm init --install-hooks (hook templates changed) — run manually");
  }

  // Step 4: post-upgrade notes
  const newVersion = readGxpmVersion({ root });
  const guides = listMigrationGuides(root, priorVersion ?? "0.0.0", newVersion);

  if (opts.dryRun) {
    console.log("DRY RUN — would execute:");
    for (const s of steps) console.log(`  ${s}`);
    if (guides.length > 0) {
      console.log("");
      console.log("Migration guides to read:");
      for (const g of guides) console.log(`  ${g}`);
    }
    return;
  }

  console.log(`Upgrade complete: ${priorVersion ?? "unknown"} -> ${newVersion}`);
  console.log("");
  if (guides.length > 0) {
    console.log("Migration guides for versions you skipped:");
    for (const g of guides) {
      console.log(`  ${g}`);
    }
    console.log("");
    console.log("Read each guide and run any backfill steps listed before continuing.");
  }
  if (hooksChanged) {
    console.log("");
    console.log("Hook templates changed. Run `gxpm init --install-hooks --target <repo>` to update.");
  }
}

export function runPostUpgradeCommand(argv: string[]) {
  const root = getGxpmRoot();
  const currentVersion = readGxpmVersion({ root });

  // Find all migration guides <= current version
  const migrationsDir = join(root, "docs", "migrations");
  if (!existsSync(migrationsDir)) {
    console.log("No migrations directory found.");
    return;
  }

  const guides: string[] = [];
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith(".md")) continue;
    const v = parseVersionFromPath(file);
    if (compareSemver(v, currentVersion) <= 0) {
      guides.push(join(migrationsDir, file));
    }
  }
  guides.sort((a, b) => compareSemver(parseVersionFromPath(a), parseVersionFromPath(b)));

  console.log(`gxpm ${currentVersion} — post-upgrade notes`);
  console.log("");

  if (guides.length === 0) {
    console.log("No migration guides found.");
    return;
  }

  for (const g of guides) {
    const name = g.split("/").pop() ?? g;
    console.log(`--- ${name} ---`);
    try {
      const content = readFileSync(g, "utf-8");
      // Print only the first 30 lines to avoid flooding
      const lines = content.split("\n").slice(0, 30);
      console.log(lines.join("\n"));
      if (content.split("\n").length > 30) {
        console.log("... (truncated, read full file for details)");
      }
      console.log("");
    } catch {
      console.log("(could not read)");
    }
  }
}
