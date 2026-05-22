import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NEXUS_SCRIPT = "gitnexus analyze --skip-agents-md";
const NEXUS_FULL_SCRIPT = "gitnexus analyze";

interface HookSpec {
  gxpmFile: string;
  topLevelFile: string;
  argsForwarding: string;
}

const HOOK_SPECS: HookSpec[] = [
  { gxpmFile: "gxpm-pre-commit", topLevelFile: "pre-commit", argsForwarding: "" },
  { gxpmFile: "gxpm-commit-msg", topLevelFile: "commit-msg", argsForwarding: ' "$1"' },
  { gxpmFile: "gxpm-pre-push", topLevelFile: "pre-push", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-merge", topLevelFile: "post-merge", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-checkout", topLevelFile: "post-checkout", argsForwarding: ' "$@"' },
];

function dispatcherScript(gxpmFile: string, argsForwarding: string): string {
  return `#!/bin/bash
# gxpm dispatcher (installed by gxpm-init --install-hooks)
# Calls the gxpm-specific hook if present; harmless otherwise.
set -e
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$HOOK_DIR/${gxpmFile}" ]; then
  "$HOOK_DIR/${gxpmFile}"${argsForwarding}
fi
`;
}

interface InstallOptions {
  target: string;
  skipNexusScript: boolean;
}

function parseArgs(argv: string[]): InstallOptions {
  const dashTarget = argv.indexOf("--target");
  const target = dashTarget >= 0 ? argv[dashTarget + 1] : process.cwd();
  const skipNexusScript = argv.includes("--skip-nexus-script");
  return { target: resolve(target), skipNexusScript };
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

function main(argv: string[]) {
  const { target, skipNexusScript } = parseArgs(argv);

  if (!isGitRepo(target)) {
    console.error(`Not a git repository: ${target}`);
    process.exit(1);
  }

  const templatesDir = resolve(import.meta.dir, "..", "templates", "hooks");
  const hooksDir = join(target, ".githooks");
  mkdirSync(hooksDir, { recursive: true });

  const skipped: string[] = [];

  for (const spec of HOOK_SPECS) {
    const src = join(templatesDir, spec.gxpmFile);
    const dst = join(hooksDir, spec.gxpmFile);
    copyFileSync(src, dst);
    execSync(`chmod +x "${dst}"`);
    console.log(`installed: .githooks/${spec.gxpmFile}`);

    const topLevelPath = join(hooksDir, spec.topLevelFile);
    if (!existsSync(topLevelPath)) {
      writeFileSync(topLevelPath, dispatcherScript(spec.gxpmFile, spec.argsForwarding));
      execSync(`chmod +x "${topLevelPath}"`);
      console.log(`created dispatcher: .githooks/${spec.topLevelFile}`);
    } else {
      skipped.push(spec.topLevelFile);
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
    console.log(`set git config core.hooksPath = ${absoluteHooksPath}`);
  } else {
    console.log(`core.hooksPath already = ${absoluteHooksPath}`);
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Existing top-level hooks were NOT overwritten:");
    for (const name of skipped) {
      console.log(`  .githooks/${name}`);
    }
    console.log("To wire gxpm into them, append:");
    console.log('  [ -x .githooks/gxpm-<hook-name> ] && .githooks/gxpm-<hook-name> "$@"');
  }

  const gxpmRoot = resolve(import.meta.dir, "..");
  installAgentsFragment(target, gxpmRoot);
  installNexusScript(target, { skip: skipNexusScript });
}

function installNexusScript(target: string, options: { skip: boolean }): void {
  if (options.skip) return;
  const pkgPath = join(target, "package.json");
  if (!existsSync(pkgPath)) return;

  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.scripts = pkg.scripts ?? {};

  if ("nexus" in pkg.scripts) {
    console.log("[install-hooks] skipped nexus script: already exists");
    return;
  }

  pkg.scripts.nexus = NEXUS_SCRIPT;
  pkg.scripts["nexus:full"] = NEXUS_FULL_SCRIPT;

  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  const next = JSON.stringify(pkg, null, 2) + trailingNewline;

  const tmpPath = `${pkgPath}.tmp`;
  writeFileSync(tmpPath, next);
  renameSync(tmpPath, pkgPath);
  console.log(`installed nexus scripts in: ${pkgPath}`);
}

function installAgentsFragment(target: string, _gxpmRoot: string): void {
  const agentsPath = join(target, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    return;
  }

  const MARKER_START = "<!-- GXPM:CODE-REVIEW-GRAPH:START -->";
  const MARKER_END = "<!-- GXPM:CODE-REVIEW-GRAPH:END -->";

  let content = readFileSync(agentsPath, "utf8");
  if (content.includes(MARKER_START) && content.includes(MARKER_END)) {
    const regex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g");
    content = content.replace(regex, "");
    writeFileSync(agentsPath, content);
    console.log(`cleaned legacy graph marker from: ${agentsPath}`);
  }
}

main(Bun.argv.slice(2));
